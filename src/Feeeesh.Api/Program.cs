using Feeeesh.Api.Data;
using Feeeesh.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=feeeesh.dev.db"));

builder.Services.AddScoped<SessionService>();
builder.Services.AddScoped<CareTicker>();
builder.Services.AddScoped<FeeeeshGameService>();

builder.Services.AddCors(opt =>
{
    opt.AddPolicy("web", p => p
        .WithOrigins(
            "http://localhost:4200",
            "http://127.0.0.1:4200")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    if (!db.Species.Any())
    {
        db.Species.AddRange(SpeciesCatalog.All);
        db.SaveChanges();
    }
}

app.UseCors("web");
app.MapControllers();
app.MapGet("/api/health", () => Results.Ok(new { name = "Feeeesh", ok = true }));

app.Run();
