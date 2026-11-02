using Feeeesh.Api.Domain;

namespace Feeeesh.Api.Data;

public static class SpeciesCatalog
{
    public static readonly IReadOnlyList<Species> All =
    [
        new() { Id = "pebble-minnow", Name = "Pebble Minnow", Rarity = Rarity.Common, ColorHex = "#9ad0e8", AccentHex = "#2c6e8a", Size = 0.85 },
        new() { Id = "lily-guppy", Name = "Lily Guppy", Rarity = Rarity.Common, ColorHex = "#f4a6c8", AccentHex = "#a8457a", Size = 0.8 },
        new() { Id = "sand-dart", Name = "Sand Dart", Rarity = Rarity.Common, ColorHex = "#e8d5a3", AccentHex = "#8a6b2c", Size = 0.9 },
        new() { Id = "reed-perch", Name = "Reed Perch", Rarity = Rarity.Common, ColorHex = "#8fbc8f", AccentHex = "#3d6b3d", Size = 1.0 },
        new() { Id = "copper-fin", Name = "Copper Fin", Rarity = Rarity.Uncommon, ColorHex = "#d9894b", AccentHex = "#7a3e16", Size = 1.05 },
        new() { Id = "mist-tetra", Name = "Mist Tetra", Rarity = Rarity.Uncommon, ColorHex = "#b8c5e6", AccentHex = "#4a5f9e", Size = 0.95 },
        new() { Id = "amber-loach", Name = "Amber Loach", Rarity = Rarity.Uncommon, ColorHex = "#f0b429", AccentHex = "#8a5a00", Size = 1.1 },
        new() { Id = "coral-wisp", Name = "Coral Wisp", Rarity = Rarity.Rare, ColorHex = "#ff6f61", AccentHex = "#9c2a22", Size = 1.15 },
        new() { Id = "moon-scale", Name = "Moon Scale", Rarity = Rarity.Rare, ColorHex = "#c9d6ff", AccentHex = "#5b6ea6", Size = 1.2 },
        new() { Id = "jade-veil", Name = "Jade Veil", Rarity = Rarity.Rare, ColorHex = "#3ecf8e", AccentHex = "#1a6b45", Size = 1.25 },
        new() { Id = "aurora-koi", Name = "Aurora Koi", Rarity = Rarity.Legendary, ColorHex = "#ffd166", AccentHex = "#ef476f", Size = 1.45 },
        new() { Id = "abyss-lantern", Name = "Abyss Lantern", Rarity = Rarity.Legendary, ColorHex = "#7b2cbf", AccentHex = "#e0aaff", Size = 1.4 }
    ];

    // Weights for loot rolls (higher = more common)
    public static readonly IReadOnlyDictionary<Rarity, int> Weights = new Dictionary<Rarity, int>
    {
        [Rarity.Common] = 55,
        [Rarity.Uncommon] = 28,
        [Rarity.Rare] = 14,
        [Rarity.Legendary] = 3
    };
}
