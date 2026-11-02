using Feeeesh.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Feeeesh.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Tank> Tanks => Set<Tank>();
    public DbSet<Species> Species => Set<Species>();
    public DbSet<FishInstance> Fish => Set<FishInstance>();
    public DbSet<SessionToken> Sessions => Set<SessionToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Email);
            e.HasOne(x => x.Tank).WithOne(t => t.Owner).HasForeignKey<Tank>(t => t.OwnerId);
        });

        modelBuilder.Entity<Tank>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Slug).IsUnique();
            e.HasIndex(x => x.VanitySlug);
        });

        modelBuilder.Entity<Species>(e =>
        {
            e.HasKey(x => x.Id);
        });

        modelBuilder.Entity<FishInstance>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Species).WithMany().HasForeignKey(x => x.SpeciesId);
        });

        modelBuilder.Entity<SessionToken>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.TokenHash).IsUnique();
        });
    }
}
