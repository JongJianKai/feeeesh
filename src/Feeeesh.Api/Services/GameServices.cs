using System.Security.Cryptography;
using System.Text;
using Feeeesh.Api.Data;
using Feeeesh.Api.Domain;
using Feeeesh.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Feeeesh.Api.Services;

public static class SlugUtil
{
    private const string Alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

    public static string RandomSlug(int length = 8)
    {
        Span<char> chars = stackalloc char[length];
        for (var i = 0; i < length; i++)
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return new string(chars);
    }

    public static bool IsValidVanity(string slug) =>
        slug.Length is >= 3 and <= 24
        && slug.All(c => char.IsAsciiLetterOrDigit(c) || c == '-')
        && !slug.StartsWith('-') && !slug.EndsWith('-');
}

public static class PasswordUtil
{
    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = HashWithSalt(password, salt);
        return $"v1.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split('.');
        if (parts.Length != 3 || parts[0] != "v1") return false;
        var salt = Convert.FromBase64String(parts[1]);
        var expected = Convert.FromBase64String(parts[2]);
        var actual = HashWithSalt(password, salt);
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    private static byte[] HashWithSalt(string password, byte[] salt)
    {
        return Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            salt,
            100_000,
            HashAlgorithmName.SHA256,
            32);
    }
}

public class SessionService(AppDbContext db)
{
    public const string CookieName = "feeeesh_session";

    public async Task<(string rawToken, SessionToken row)> IssueAsync(Guid userId, CancellationToken ct = default)
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var row = new SessionToken
        {
            UserId = userId,
            TokenHash = Sha256(raw),
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(30)
        };
        db.Sessions.Add(row);
        await db.SaveChangesAsync(ct);
        return (raw, row);
    }

    public async Task<AppUser?> ResolveUserAsync(string? rawToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(rawToken)) return null;
        // Cookie middleware may leave tokens URL-encoded; normalize.
        rawToken = Uri.UnescapeDataString(rawToken);
        var hash = Sha256(rawToken);
        var session = await db.Sessions
            .Include(s => s.User).ThenInclude(u => u.Tank)!.ThenInclude(t => t!.Fish).ThenInclude(f => f.Species)
            .FirstOrDefaultAsync(s => s.TokenHash == hash, ct);
        if (session is null || session.ExpiresAt <= DateTimeOffset.UtcNow) return null;
        return session.User;
    }

    public static string Sha256(string raw)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes);
    }
}

public class CareTicker(AppDbContext db)
{
    // Soft decline: NeedsCare after 36h untended, Down after 72h. Paused roughly while "recently tended".
    public async Task ApplyAsync(Tank tank, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var fish in tank.Fish.Where(f => f.InTank))
        {
            var hours = (now - fish.LastTendedAt).TotalHours;
            var next = hours switch
            {
                >= 72 => CareState.Down,
                >= 36 => CareState.NeedsCare,
                _ => CareState.Healthy
            };
            if (fish.Care != next) fish.Care = next;
        }
        tank.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
    }
}

public class FeeeeshGameService(AppDbContext db, SessionService sessions, CareTicker care)
{
    public const int CastCost = 15;
    public const int TendCost = 0; // free tend when NeedsCare
    public const int ReviveBaseCost = 8;

    public async Task<AuthResponse> CreateGuestAsync(CancellationToken ct = default)
    {
        var userId = Guid.NewGuid();
        var tankId = Guid.NewGuid();
        var slug = await UniqueRandomSlugAsync(ct);

        var user = new AppUser { Id = userId, IsGuest = true, Pearls = 40 };
        var tank = new Tank { Id = tankId, OwnerId = userId, Slug = slug };
        db.Users.Add(user);
        db.Tanks.Add(tank);
        await db.SaveChangesAsync(ct);

        var commonIds = await db.Species.AsNoTracking()
            .Where(s => s.Rarity == Rarity.Common)
            .Select(s => s.Id)
            .ToListAsync(ct);
        for (var i = 0; i < 2; i++)
        {
            var speciesId = commonIds[RandomNumberGenerator.GetInt32(commonIds.Count)];
            db.Fish.Add(MakeFish(tankId, speciesId, i));
        }
        await db.SaveChangesAsync(ct);

        var (token, _) = await sessions.IssueAsync(userId, ct);
        var loaded = await db.Users
            .Include(u => u.Tank)!.ThenInclude(t => t!.Fish).ThenInclude(f => f.Species)
            .FirstAsync(u => u.Id == userId, ct);
        return new AuthResponse(token, await ToMeAsync(loaded, ct));
    }

    public async Task<AuthResponse> RegisterAsync(AppUser guestOrUser, string email, string password, CancellationToken ct = default)
    {
        email = email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email) || password.Length < 8)
            throw new InvalidOperationException("Email required; password must be at least 8 characters.");

        if (await db.Users.AnyAsync(u => u.Email == email && u.Id != guestOrUser.Id, ct))
            throw new InvalidOperationException("Email already registered.");

        guestOrUser.Email = email;
        guestOrUser.PasswordHash = PasswordUtil.Hash(password);
        guestOrUser.IsGuest = false;
        guestOrUser.EmailConfirmed = true; // Dev-friendly: skip SMTP for MVP cloud demo
        await db.SaveChangesAsync(ct);

        var (token, _) = await sessions.IssueAsync(guestOrUser.Id, ct);
        return new AuthResponse(token, await ToMeAsync(guestOrUser, ct));
    }

    public async Task<AuthResponse> LoginAsync(string email, string password, CancellationToken ct = default)
    {
        email = email.Trim().ToLowerInvariant();
        var user = await db.Users
            .Include(u => u.Tank)!.ThenInclude(t => t!.Fish).ThenInclude(f => f.Species)
            .FirstOrDefaultAsync(u => u.Email == email, ct)
            ?? throw new InvalidOperationException("Invalid email or password.");

        if (user.PasswordHash is null || !PasswordUtil.Verify(password, user.PasswordHash))
            throw new InvalidOperationException("Invalid email or password.");

        var (token, _) = await sessions.IssueAsync(user.Id, ct);
        return new AuthResponse(token, await ToMeAsync(user, ct));
    }

    public async Task<MeDto> ClaimVanityAsync(AppUser user, string vanity, CancellationToken ct = default)
    {
        if (user.IsGuest)
            throw new InvalidOperationException("Register with email before claiming a vanity slug.");

        vanity = vanity.Trim().ToLowerInvariant();
        if (!SlugUtil.IsValidVanity(vanity))
            throw new InvalidOperationException("Slug must be 3–24 chars: letters, numbers, hyphens.");

        if (await db.Tanks.AnyAsync(t => t.VanitySlug == vanity || t.Slug == vanity, ct))
            throw new InvalidOperationException("That slug is taken.");

        var tank = await EnsureTankAsync(user, ct);
        tank.VanitySlug = vanity;
        tank.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ToMeAsync(user, ct);
    }

    public async Task<AcquireResultDto> ClaimDailyAsync(AppUser user, CancellationToken ct = default)
    {
        var today = DateTime.UtcNow.Date;
        if (user.LastDailyClaimUtcDate == today)
            throw new InvalidOperationException("Daily roll already claimed (UTC day).");

        user.LastDailyClaimUtcDate = today;
        var fish = await RollAndAddAsync(user, ct);
        await db.SaveChangesAsync(ct);
        return new AcquireResultDto(ToFishDto(fish), user.Pearls, "daily");
    }

    public async Task<AcquireResultDto> CastAsync(AppUser user, CancellationToken ct = default)
    {
        if (user.Pearls < CastCost)
            throw new InvalidOperationException($"Need {CastCost} Pearls to Cast.");

        user.Pearls -= CastCost;
        var fish = await RollAndAddAsync(user, ct);
        await db.SaveChangesAsync(ct);
        return new AcquireResultDto(ToFishDto(fish), user.Pearls, "cast");
    }

    public async Task<MeDto> TendAsync(AppUser user, Guid? fishId, CancellationToken ct = default)
    {
        var tank = await EnsureTankAsync(user, ct);
        await care.ApplyAsync(tank, ct);

        var targets = tank.Fish.Where(f => f.InTank && (fishId == null || f.Id == fishId)).ToList();
        if (fishId != null && targets.Count == 0)
            throw new InvalidOperationException("Fish not found.");

        foreach (var fish in targets)
        {
            if (fish.Care == CareState.Healthy) continue;

            if (fish.Care == CareState.Down)
            {
                var cost = ReviveBaseCost + (int)fish.Species.Rarity * 2;
                if (user.Pearls < cost)
                    throw new InvalidOperationException($"Need {cost} Pearls to revive {fish.Species.Name}.");
                user.Pearls -= cost;
            }
            // NeedsCare tend is free (TendCost = 0) for cozy MVP.

            fish.Care = CareState.Healthy;
            fish.LastTendedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        return await ToMeAsync(user, ct);
    }

    public async Task<MeDto> PlaceAsync(AppUser user, PlaceFishRequest req, CancellationToken ct = default)
    {
        var tank = await EnsureTankAsync(user, ct);
        var fish = tank.Fish.FirstOrDefault(f => f.Id == req.FishId)
            ?? throw new InvalidOperationException("Fish not found.");

        if (!fish.InTank)
        {
            var occupied = tank.Fish.Count(f => f.InTank);
            if (occupied >= tank.Capacity)
                throw new InvalidOperationException("Tank is full.");
            fish.InTank = true;
        }

        fish.PosX = req.PosX ?? fish.PosX;
        fish.PosY = req.PosY ?? fish.PosY;
        fish.PosZ = req.PosZ ?? fish.PosZ;
        tank.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ToMeAsync(user, ct);
    }

    public async Task<MeDto> RemoveFromTankAsync(AppUser user, Guid fishId, CancellationToken ct = default)
    {
        var tank = await EnsureTankAsync(user, ct);
        var fish = tank.Fish.FirstOrDefault(f => f.Id == fishId)
            ?? throw new InvalidOperationException("Fish not found.");
        fish.InTank = false;
        tank.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ToMeAsync(user, ct);
    }

    public async Task<TankDto?> GetPublicTankAsync(string slug, CancellationToken ct = default)
    {
        slug = slug.Trim().ToLowerInvariant();
        var tank = await db.Tanks
            .Include(t => t.Fish).ThenInclude(f => f.Species)
            .FirstOrDefaultAsync(t => t.Slug == slug || t.VanitySlug == slug, ct);
        if (tank is null) return null;
        await care.ApplyAsync(tank, ct);
        return ToTankDto(tank);
    }

    public async Task<MeDto> ToMeAsync(AppUser user, CancellationToken ct = default)
    {
        var tank = await EnsureTankAsync(user, ct);
        await care.ApplyAsync(tank, ct);
        var today = DateTime.UtcNow.Date;
        return new MeDto(
            user.Id,
            user.IsGuest,
            user.Email,
            user.EmailConfirmed,
            user.Pearls,
            user.LastDailyClaimUtcDate != today,
            ToTankDto(tank));
    }

    private async Task<FishInstance> RollAndAddAsync(AppUser user, CancellationToken ct)
    {
        var tank = await EnsureTankAsync(user, ct);
        var speciesId = await RollSpeciesIdAsync(ct);
        var idx = tank.Fish.Count;
        var fish = MakeFish(tank.Id, speciesId, idx);
        if (tank.Fish.Count(f => f.InTank) >= tank.Capacity)
            fish.InTank = false;
        db.Fish.Add(fish);
        tank.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await db.Entry(fish).Reference(f => f.Species).LoadAsync(ct);
        return fish;
    }

    private async Task<string> RollSpeciesIdAsync(CancellationToken ct)
    {
        var total = SpeciesCatalog.Weights.Values.Sum();
        var roll = RandomNumberGenerator.GetInt32(total);
        var acc = 0;
        Rarity picked = Rarity.Common;
        foreach (var (rarity, weight) in SpeciesCatalog.Weights)
        {
            acc += weight;
            if (roll < acc)
            {
                picked = rarity;
                break;
            }
        }

        var pool = await db.Species.AsNoTracking()
            .Where(s => s.Rarity == picked)
            .Select(s => s.Id)
            .ToListAsync(ct);
        return pool[RandomNumberGenerator.GetInt32(pool.Count)];
    }

    private static FishInstance MakeFish(Guid tankId, string speciesId, int index)
    {
        var x = -1.6f + (index % 4) * 1.0f + RandomNumberGenerator.GetInt32(20) / 100f;
        var y = -0.4f + (index / 4) * 0.5f + RandomNumberGenerator.GetInt32(20) / 100f;
        var z = -0.4f + RandomNumberGenerator.GetInt32(80) / 100f;
        return new FishInstance
        {
            Id = Guid.NewGuid(),
            TankId = tankId,
            SpeciesId = speciesId,
            InTank = true,
            PosX = x,
            PosY = y,
            PosZ = z,
            Care = CareState.Healthy,
            LastTendedAt = DateTimeOffset.UtcNow
        };
    }

    private async Task<Tank> EnsureTankAsync(AppUser user, CancellationToken ct)
    {
        if (user.Tank is { Fish: not null } t && t.Fish.All(f => f.Species != null))
            return user.Tank;

        var tank = await db.Tanks
            .Include(x => x.Fish).ThenInclude(f => f.Species)
            .FirstAsync(x => x.OwnerId == user.Id, ct);
        user.Tank = tank;
        return tank;
    }

    private async Task<string> UniqueRandomSlugAsync(CancellationToken ct)
    {
        for (var i = 0; i < 20; i++)
        {
            var slug = SlugUtil.RandomSlug();
            if (!await db.Tanks.AnyAsync(t => t.Slug == slug || t.VanitySlug == slug, ct))
                return slug;
        }
        return SlugUtil.RandomSlug(12);
    }

    private static TankDto ToTankDto(Tank tank)
    {
        var pathSlug = tank.VanitySlug ?? tank.Slug;
        var inTank = tank.Fish.Where(f => f.InTank).Select(ToFishDto).ToList();
        return new TankDto(
            tank.Id,
            tank.Slug,
            tank.VanitySlug,
            $"/t/{pathSlug}",
            tank.Capacity,
            inTank.Count,
            tank.Fish.Select(ToFishDto).ToList());
    }

    private static FishDto ToFishDto(FishInstance f) => new(
        f.Id,
        f.SpeciesId,
        f.Species.Name,
        f.Species.Rarity.ToString(),
        f.Species.ColorHex,
        f.Species.AccentHex,
        f.Species.Size,
        f.InTank,
        f.PosX,
        f.PosY,
        f.PosZ,
        f.Care.ToString(),
        f.Nickname,
        f.AcquiredAt);
}
