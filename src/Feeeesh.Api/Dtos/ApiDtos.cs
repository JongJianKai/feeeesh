using Feeeesh.Api.Domain;

namespace Feeeesh.Api.Dtos;

public record FishDto(
    Guid Id,
    string SpeciesId,
    string SpeciesName,
    string Rarity,
    string ColorHex,
    string AccentHex,
    double Size,
    bool InTank,
    float PosX,
    float PosY,
    float PosZ,
    string Care,
    string? Nickname,
    DateTimeOffset AcquiredAt
);

public record TankDto(
    Guid Id,
    string Slug,
    string? VanitySlug,
    string PublicPath,
    int Capacity,
    int Occupied,
    IReadOnlyList<FishDto> Fish
);

public record MeDto(
    Guid UserId,
    bool IsGuest,
    string? Email,
    bool EmailConfirmed,
    int Pearls,
    bool DailyClaimAvailable,
    TankDto Tank
);

public record AuthResponse(string Token, MeDto Me);

public record RegisterRequest(string Email, string Password);
public record LoginRequest(string Email, string Password);
public record ClaimVanityRequest(string Slug);
public record PlaceFishRequest(Guid FishId, float? PosX, float? PosY, float? PosZ);
public record AcquireResultDto(FishDto Fish, int PearlsRemaining, string Source);
