# Visor de Canchas - Sabaneta

Mapa interactivo (Leaflet) que muestra canchas deportivas de Sabaneta,
consultando los datos desde una base de datos en Supabase.

## Estructura

```
index.html        -> página principal
app.js            -> lógica del mapa y consulta a Supabase
config.js         -> URL y "anon key" de Supabase (NO son secretas, ver abajo)
supabase/schema.sql -> script para crear la tabla, la seguridad (RLS) y cargar los datos
```

## 1. Crear el proyecto en Supabase

1. Entra a https://supabase.com y crea un proyecto nuevo.
2. Ve a **SQL Editor** (menú lateral) > **New query**.
3. Pega TODO el contenido de `supabase/schema.sql` y dale **Run**.
   Esto crea la tabla `canchas`, activa Row Level Security (RLS) y
   carga las 7 canchas que ya tenías en `canchas_sabaneta.js`.
4. Ve a **Project Settings > API**. Ahí vas a ver dos valores:
   - **Project URL** (algo como `https://xxxx.supabase.co`)
   - **anon / public key** (una llave larga tipo JWT)

## 2. Configurar el frontend

Abre `config.js` y reemplaza:

```js
const SUPABASE_URL = "PON_AQUI_TU_SUPABASE_URL";
const SUPABASE_ANON_KEY = "PON_AQUI_TU_ANON_KEY";
```

con los valores del paso anterior.

**¿Por qué esto no es inseguro?**
La `anon key` está hecha para ir en el navegador (cualquiera que vea
el código fuente de tu página la va a poder ver, y está bien que así sea).
Lo que la hace segura es que la tabla tiene **RLS activado** con una
única política: "solo lectura" (`select`). Es decir, con esa llave
nadie puede insertar, borrar ni modificar nada en tu base de datos,
solo puede leer las canchas — que es justo lo que tu sitio necesita.

La llave que **nunca** debe aparecer en este proyecto es la
**`service_role` key** (aparece en el mismo panel de Supabase, más abajo).
Esa sí se salta toda la seguridad y solo debería usarse desde un
servidor, nunca desde el navegador. Como este proyecto no necesita
escribir datos, no la vas a usar por ahora.

## 3. Subir el proyecto a GitHub

```bash
git init
git add .
git commit -m "Visor de canchas con Supabase"
git branch -M main
git remote add origin https://github.com/USUARIO/REPO.git
git push -u origin main
```

## 4. Desplegar en Vercel

1. Entra a https://vercel.com y da clic en **Add New > Project**.
2. Importa el repositorio de GitHub que acabas de crear.
3. Como es un sitio estático (sin build), deja el "Framework Preset"
   en **Other** y el "Build Command" / "Output Directory" en blanco.
4. Dale **Deploy**.


