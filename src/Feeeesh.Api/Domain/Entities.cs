namespace Feeeesh.Api.Domain;

public enum Rarity
{
    Common = 1,
    Uncommon = 2,
    Rare = 3,
    Legendary = 4
}

public enum CareState
{
    Healthy = 0,
    NeedsCare = 1,
    Down = 2
}

public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? Email { get; set; }
    public string? PasswordHash { get; set; }
    public bool EmailConfirmed { get; set; }
    public bool IsGuest { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public int Pearls { get; set; } = 40;
    public DateTime? LastDailyClaimUtcDate { get; set; }
    public Tank? Tank { get; set; }
}

public class Tank
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public AppUser Owner { get; set; } = null!;
    public string Slug { get; set; } = "";
    public string? VanitySlug { get; set; }
    public int Capacity { get; set; } = 8;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<FishInstance> Fish { get; set; } = [];
}

public class Species
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public Rarity Rarity { get; set; }
    public string ColorHex { get; set; } = "#7ec8e3";
    public string AccentHex { get; set; } = "#1b4f72";
    public double Size { get; set; } = 1.0;
}

public class FishInstance
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TankId { get; set; }
    public Tank Tank { get; set; } = null!;
    public string SpeciesId { get; set; } = "";
    public Species Species { get; set; } = null!;
    public bool InTank { get; set; } = true;
    public float PosX { get; set; }
    public float PosY { get; set; }
    public float PosZ { get; set; }
    public CareState Care { get; set; } = CareState.Healthy;
    public DateTimeOffset AcquiredAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastTendedAt { get; set; } = DateTimeOffset.UtcNow;
    public string? Nickname { get; set; }
}

public class SessionToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public string TokenHash { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
