# 🚀 Azure DevOps Pipeline Dashboard

Dashboard MVP para visualizar el estado de los pipelines (runs) en Azure DevOps.

## Características

- ✅ Lista todos los pipelines del proyecto con su último run
- 🎨 Badges de color por estado (succeeded, failed, canceled, etc.)
- 🔗 Link directo al run en Azure DevOps
- 🔄 Auto-refresh cada 30 segundos
- 🔒 PAT protegido en el backend (nunca se expone al navegador)
- ⚡ Cache de 30 segundos para evitar exceso de llamadas a la API
- 📱 Diseño responsive

## Requisitos

- Node.js 18+
- Un PAT (Personal Access Token) de Azure DevOps con permisos:
  - **Build: Read** (mínimo)

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo de configuración
cp .env.example .env

# 3. Editar .env con tu PAT real
# AZDO_PAT=tu-token-aqui

# 4. Iniciar el servidor
npm start
```

## Configuración (.env)

| Variable       | Descripción                        | Ejemplo                  |
| -------------- | ---------------------------------- | ------------------------ |
| `AZDO_ORG`     | Organización de Azure DevOps       | `devopsibk`              |
| `AZDO_PROJECT` | Nombre del proyecto                | `dopjeu2c001bcvpv01`     |
| `AZDO_PAT`     | Personal Access Token              | `xxxxxxxxxxxxxxxxxxxxxx` |
| `PORT`         | Puerto del servidor (default 3000) | `3000`                   |

## Uso

Abre el navegador en `http://localhost:3000`.

## Arquitectura

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  Navegador (UI)  │────▶│  Express Server  │────▶│  Azure DevOps API    │
│  HTML/CSS/JS     │     │  (proxy + cache) │     │  (REST API v7.1)     │
│                  │◀────│  PAT seguro      │◀────│                      │
└──────────────────┘     └──────────────────┘     └──────────────────────┘
```

## API del Backend

| Endpoint          | Método | Descripción                                  |
| ----------------- | ------ | -------------------------------------------- |
| `/api/pipelines`  | GET    | Lista pipelines con su último run            |
| `/api/health`     | GET    | Health check                                 |

## Desarrollo

```bash
# Modo watch (reinicia automáticamente al guardar)
npm run dev
```

