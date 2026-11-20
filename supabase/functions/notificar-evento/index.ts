// supabase/functions/notificar-evento/index.ts
// Se dispara con el trigger de Postgres (tabla eventos, INSERT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

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

function construirMensajeEvento(ev: Record<string, unknown>, nombreCancha: string) {
  const tipo = String(ev.tipo_evento || "");
  const titulo = String(ev.titulo || tipo || "Nuevo evento");
  const formato = ev.formato_partido ? ` (${ev.formato_partido})` : "";

  if (tipo === "Torneo") {
    return {
      asunto: `🏆 ¡Inscríbete al torneo en Sabaneta!: ${titulo}`,
      badge: "TORNEO ABIERTO",
      encabezado: `¡Inscríbete al torneo ${titulo}!`,
      bajada: `Se abrió convocatoria para un torneo en ${nombreCancha}. Revisa los cupos disponibles y registra tu equipo.`,
      boton: "Inscribirme / Ver torneo",
    };
  }

  if (Boolean(ev.necesita_rival)) {
    return {
      asunto: `⚔️ ¡Buscan rival${formato} en ${nombreCancha}!`,
      badge: "BUSCAN RIVAL",
      encabezado: `¡Un equipo está buscando rival${formato}!`,
      bajada: `Alguien publicó un ${tipo.toLowerCase() || "partido"} en ${nombreCancha} y necesita equipo rival para jugar.`,
      boton: "Aceptar reto / Ver evento",
    };
  }

  if (Boolean(ev.faltan_jugadores)) {
    const cant = Number(ev.jugadores_faltantes) || 0;
    const textoCant = cant > 0 ? `${cant} jugador${cant === 1 ? "" : "es"}` : "jugadores";
    return {
      asunto: `⚽ ¡Faltan ${textoCant} para jugar en ${nombreCancha}!`,
      badge: "FALTAN JUGADORES",
      encabezado: `¡Faltan ${textoCant} para completar el partido!`,
      bajada: `Hay un encuentro armado en ${nombreCancha} y están buscando completar cupo.`,
      boton: "Unirme al partido",
    };
  }

  return {
    asunto: `📣 Nuevo evento en Sabaneta: ${titulo}`,
    badge: "NUEVO EVENTO",
    encabezado: titulo,
    bajada: `Se publicó una nueva actividad deportiva en ${nombreCancha}.`,
    boton: "Ver evento en el visor",
  };
}

Deno.serve(async (req) => {
  try {
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
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");

    if (!supabaseUrl || !serviceRoleKey || !smtpHost || !smtpUser || !smtpPass || !siteUrl) {
      return new Response(
        JSON.stringify({
          error: "Faltan variables de entorno SMTP",
          faltantes: {
            SUPABASE_URL: !supabaseUrl,
            SUPABASE_SERVICE_ROLE_KEY: !serviceRoleKey,
            SMTP_HOST: !smtpHost,
            SMTP_USER: !smtpUser,
            SMTP_PASS: !smtpPass,
            SITE_URL: !siteUrl,
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(supabaseUrl, serviceRoleKey);

    const canchaId = ev.cancha_id;
    const { data: cancha } = canchaId != null && canchaId !== ""
      ? await sb.from("canchas").select("nombre").eq("id", canchaId).maybeSingle()
      : { data: null };

    const nombreCancha = String(cancha?.nombre || "Escenario deportivo de Sabaneta");

    const { data: users, error: usersError } = await sb
      .from("profiles")
      .select("email, nombre")
      .eq("acepta_notificaciones", true)
      .not("email", "is", null);

    if (usersError) {
      return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
    }

    const destinatarios = (users ?? [])
      .map((u) => ({ email: String(u.email || "").trim(), nombre: u.nombre as string | null }))
      .filter((u) => u.email.length > 0);

    if (destinatarios.length === 0) {
      return new Response(JSON.stringify({ enviados: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams();
    if (canchaId != null && canchaId !== "") params.set("cancha", String(canchaId));
    if (ev.id != null && ev.id !== "") params.set("evento", String(ev.id));
    const enlace = `${siteUrl}/${params.toString() ? `?${params.toString()}` : ""}`;

    const msg = construirMensajeEvento(ev, nombreCancha);
    const cuando = formatearFechaCo(ev.fecha_hora || ev.fecha_inicio);

    const html = (nombre: string | null) => `
    <div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;border:1px solid #dbe5df;border-radius:14px;overflow:hidden;background:#ffffff">
      <div style="background:#0d2a23;color:#fff;padding:18px 22px;border-bottom:4px solid #f0c419">
        <strong style="font-size:18px">⚽ Sabaneta en la jugada</strong>
      </div>
      <div style="padding:24px">
        <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;letter-spacing:.05em">
          ${esc(msg.badge)}
        </span>
        <p style="margin:14px 0 6px;color:#11261f">Hola <b>${esc(nombre || "jugador")}</b>,</p>
        <h2 style="margin:4px 0 10px;color:#0d2a23;font-size:21px">${esc(msg.encabezado)}</h2>
        <p style="margin:0 0 16px;color:#3d524a;line-height:1.5">${esc(msg.bajada)}</p>

        <div style="background:#f4f8f6;border:1px solid #dbe5df;border-radius:10px;padding:14px 16px;margin-bottom:18px">
          <p style="margin:4px 0;color:#11261f"><b>🏟️ Cancha:</b> ${esc(nombreCancha)}</p>
          <p style="margin:4px 0;color:#11261f"><b>📋 Modalidad:</b> ${esc(ev.tipo_evento)}${ev.formato_partido ? ` · ${esc(ev.formato_partido)}` : ""}</p>
          ${cuando ? `<p style="margin:4px 0;color:#11261f"><b>📅 Cuándo:</b> ${esc(cuando)}</p>` : ""}
          ${ev.tipo_evento === "Torneo" && ev.cupos_equipos ? `<p style="margin:4px 0;color:#11261f"><b>🛡️ Cupos:</b> ${esc(ev.cupos_equipos)} equipos</p>` : ""}
          ${ev.tipo_evento === "Reto / Apostado" && Number(ev.monto_apuesta) > 0 ? `<p style="margin:4px 0;color:#11261f"><b>💵 Apuesta:</b> $${Number(ev.monto_apuesta).toLocaleString("es-CO")}</p>` : ""}
          ${ev.contacto ? `<p style="margin:4px 0;color:#11261f"><b>📞 Contacto:</b> ${esc(ev.contacto)}</p>` : ""}
          ${ev.descripcion ? `<p style="margin:8px 0 0;color:#3d524a">“${esc(ev.descripcion)}”</p>` : ""}
        </div>

        <p style="text-align:center;margin:24px 0 10px">
          <a href="${esc(enlace)}" style="display:inline-block;background:#1f7a4d;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:bold;font-size:15px">
            ${esc(msg.boton)}
          </a>
        </p>
        <p style="font-size:12px;color:#6a776f;text-align:center;margin:0">
          El enlace abrirá directamente la cancha y sus eventos activos en el visor.
        </p>
      </div>
    </div>`;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    let enviados = 0;
    const errores: Array<{ email: string; error: string }> = [];

    for (const u of destinatarios) {
      try {
        await transporter.sendMail({
          from: `"Sabaneta en la jugada" <${smtpUser}>`,
          to: u.email,
          subject: msg.asunto,
          html: html(u.nombre),
        });
        enviados++;
      } catch (mailErr) {
        errores.push({ email: u.email, error: String(mailErr) });
      }
    }

    return new Response(JSON.stringify({ enviados, errores }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});