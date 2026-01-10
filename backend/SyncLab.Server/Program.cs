using SyncLab.Server.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<RoomStore>();
builder.Services.AddSingleton<WsHub>();

builder.Services.AddCors(o =>
{
    o.AddDefaultPolicy(p => p
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()
        .SetIsOriginAllowed(_ => true)); // dev-friendly
});

var app = builder.Build();

app.UseCors();
app.UseWebSockets();

app.MapGet("/api/health", () => Results.Ok(new { ok = true, ts = DateTimeOffset.UtcNow }));

app.Map("/ws", async (HttpContext ctx, WsHub hub) =>
{
    await hub.HandleAsync(ctx);
});

app.Run("http://0.0.0.0:8080");