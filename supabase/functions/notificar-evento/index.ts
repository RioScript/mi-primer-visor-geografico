// supabase/functions/notificar-evento/index.ts
// Se dispara con un Database Webhook (tabla eventos, INSERT).
// Secrets necesarios:
//   RESEND_API_KEY, MAIL_FROM, SITE_URL, WEBHOOK_SECRET
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function formatearFechaCo(valor: unknown): string {
  const raw = String(valor ?? "").trim();
  if (!raw) return "";
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const d = new Date(soloFecha ? `${raw}T12:00:00-05:00` : raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    ...(soloFecha ? {} : { timeStyle: "short" }),
  });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("No autorizado", { status: 401 });
  }

  let payload: { record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  const ev = payload?.record;
  if (!ev) return new Response("Sin evento", { status: 400 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const mailFrom = Deno.env.get("MAIL_FROM");
  const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !mailFrom || !siteUrl) {
    return new Response("Faltan variables de entorno requeridas", { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  const canchaId = ev.cancha_id;
  const { data: cancha } = canchaId != null && canchaId !== ""
    ? await sb.from("canchas").select("nombre").eq("id", canchaId).maybeSingle()
    : { data: null };

  const { data: users, error: usersError } = await sb
    .from("profiles")
    .select("email, nombre")
    .eq("acepta_notificaciones", true)
    .not("email", "is", null);

  if (usersError) {
    return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
  }

  const enlace = canchaId != null && canchaId !== ""
    ? `${siteUrl}/?cancha=${encodeURIComponent(String(canchaId))}`
    : `${siteUrl}/`;

  const titulo = String(ev.titulo || ev.tipo_evento || "Nuevo evento");
  const cuando = formatearFechaCo(ev.fecha_hora || ev.fecha_inicio);

  const html = (nombre: string | null) => `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #dbe5df;border-radius:12px;overflow:hidden">
    <div style="background:#0d2a23;color:#fff;padding:18px 22px;border-bottom:4px solid #f0c419">
      <strong style="font-size:18px">Sabaneta en la jugada</strong>
    </div>
    <div style="padding:22px">
      <p>Hola ${esc(nombre || "jugador")}, hay un nuevo evento:</p>
      <h2 style="margin:6px 0">${esc(titulo)}</h2>
      <p style="margin:2px 0;color:#3d524a"><b>Tipo:</b> ${esc(ev.tipo_evento)}</p>
      <p style="margin:2px 0;color:#3d524a"><b>Cancha:</b> ${esc(cancha?.nombre || "Escenario deportivo")}</p>
      ${cuando ? `<p style="margin:2px 0;color:#3d524a"><b>Cuándo:</b> ${esc(cuando)}</p>` : ""}
      ${ev.descripcion ? `<p style="color:#3d524a">${esc(ev.descripcion)}</p>` : ""}
      ${ev.contacto ? `<p style="margin:2px 0;color:#3d524a"><b>Contacto:</b> ${esc(ev.contacto)}</p>` : ""}
      <p style="text-align:center;margin:26px 0 8px">
        <a href="${esc(enlace)}" style="background:#1f7a4d;color:#fff;text-decoration:none;padding:12px 26px;border-radius:6px;font-weight:bold">Pulse aquí</a>
      </p>
      <p style="font-size:12px;color:#6a776f;text-align:center">Te llevará directo a la cancha en el visor.</p>
    </div>
  </div>`;

  const mensajes = (users ?? [])
    .filter((u) => typeof u.email === "string" && u.email.trim().length > 0)
    .map((u) => ({
      from: mailFrom,
      to: [String(u.email).trim()],
      subject: `Nuevo evento: ${titulo}`,
      html: html(u.nombre),
    }));

  for (let i = 0; i < mensajes.length; i += 100) {
    const resp = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mensajes.slice(i, i + 100)),
    });

    if (!resp.ok) {
      const detalle = await resp.text();
      return new Response(
        JSON.stringify({ error: "Error enviando correos con Resend", detalle }),
        { status: 502 },
      );
    }
  }

  return new Response(JSON.stringify({ enviados: mensajes.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});