using Feeeesh.Api.Dtos;
using Feeeesh.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Feeeesh.Api.Controllers;

public static class AuthCookie
{
    public static void Set(HttpResponse response, string token)
    {
        response.Cookies.Append(SessionService.CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = false, // local demo; set true behind HTTPS/Azure
            SameSite = SameSiteMode.Lax,
            Expires = DateTimeOffset.UtcNow.AddDays(30),
            Path = "/"
        });
    }
}

[ApiController]
[Route("api/auth")]
public class AuthController(FeeeeshGameService game, SessionService sessions) : ControllerBase
{
    [HttpPost("guest")]
    public async Task<ActionResult<AuthResponse>> Guest(CancellationToken ct)
    {
        var existing = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct);
        if (existing is not null)
            return Ok(new AuthResponse(Request.Cookies[SessionService.CookieName]!, await game.ToMeAsync(existing, ct)));

        var result = await game.CreateGuestAsync(ct);
        AuthCookie.Set(Response, result.Token);
        return Ok(result);
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register([FromBody] RegisterRequest req, CancellationToken ct)
    {
        var user = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct)
            ?? throw new InvalidOperationException("Start as guest first.");
        try
        {
            var result = await game.RegisterAsync(user, req.Email, req.Password, ct);
            AuthCookie.Set(Response, result.Token);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest req, CancellationToken ct)
    {
        try
        {
            var result = await game.LoginAsync(req.Email, req.Password, ct);
            AuthCookie.Set(Response, result.Token);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return Unauthorized(new { error = ex.Message });
        }
    }

    [HttpPost("logout")]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(SessionService.CookieName);
        return Ok(new { ok = true });
    }
}

[ApiController]
[Route("api/me")]
public class MeController(FeeeeshGameService game, SessionService sessions) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<MeDto>> Me(CancellationToken ct)
    {
        var user = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct);
        if (user is null) return Unauthorized();
        return Ok(await game.ToMeAsync(user, ct));
    }

    [HttpPost("vanity")]
    public async Task<ActionResult<MeDto>> Vanity([FromBody] ClaimVanityRequest req, CancellationToken ct)
    {
        var user = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct);
        if (user is null) return Unauthorized();
        try
        {
            return Ok(await game.ClaimVanityAsync(user, req.Slug, ct));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}

[ApiController]
[Route("api/game")]
public class GameController(FeeeeshGameService game, SessionService sessions) : ControllerBase
{
    [HttpPost("daily")]
    public async Task<ActionResult<AcquireResultDto>> Daily(CancellationToken ct)
    {
        var user = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct);
        if (user is null) return Unauthorized();
        try { return Ok(await game.ClaimDailyAsync(user, ct)); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("cast")]
    public async Task<ActionResult<AcquireResultDto>> Cast(CancellationToken ct)
    {
        var user = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct);
        if (user is null) return Unauthorized();
        try { return Ok(await game.CastAsync(user, ct)); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("tend")]
    public async Task<ActionResult<MeDto>> Tend([FromQuery] Guid? fishId, CancellationToken ct)
    {
        var user = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct);
        if (user is null) return Unauthorized();
        try { return Ok(await game.TendAsync(user, fishId, ct)); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("place")]
    public async Task<ActionResult<MeDto>> Place([FromBody] PlaceFishRequest req, CancellationToken ct)
    {
        var user = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct);
        if (user is null) return Unauthorized();
        try { return Ok(await game.PlaceAsync(user, req, ct)); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("remove/{fishId:guid}")]
    public async Task<ActionResult<MeDto>> Remove(Guid fishId, CancellationToken ct)
    {
        var user = await sessions.ResolveUserAsync(Request.Cookies[SessionService.CookieName], ct);
        if (user is null) return Unauthorized();
        try { return Ok(await game.RemoveFromTankAsync(user, fishId, ct)); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }
}

[ApiController]
[Route("api/tanks")]
public class TanksController(FeeeeshGameService game) : ControllerBase
{
    [HttpGet("{slug}")]
    public async Task<ActionResult<TankDto>> Public(string slug, CancellationToken ct)
    {
        var tank = await game.GetPublicTankAsync(slug, ct);
        return tank is null ? NotFound(new { error = "Tank not found" }) : Ok(tank);
    }
}

[ApiController]
[Route("api/catalog")]
public class CatalogController : ControllerBase
{
    [HttpGet("species")]
    public IActionResult Species() => Ok(Data.SpeciesCatalog.All.Select(s => new
    {
        s.Id,
        s.Name,
        rarity = s.Rarity.ToString(),
        s.ColorHex,
        s.AccentHex,
        s.Size
    }));
}
