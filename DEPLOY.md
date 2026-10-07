# Despliegue en Vercel

Este proyecto usa HTML y TypeScript compilado para la web y una función Node.js para la API. No requiere migrarlo a otro framework.

1. Importa el repositorio en Vercel con la raíz del proyecto en `.`. La configuración versionada en `vercel.json` fija el framework en «Other», ejecuta `npm run build` y publica `public/`.
2. Configura `MONDAY_API_KEY` como variable de entorno en Vercel para los entornos que vayas a desplegar. También se acepta `monday_apiKey`. El archivo `.env` local se excluye del despliegue.
3. Si los identificadores de Monday difieren de los valores predeterminados del código, configura `monday_boardId`, `monday_boardCalendari`, `monday_groupId` y `monday_workspaceSubvencions` según corresponda.
4. Despliega y comprueba `/`, `/dist/app.js` y `/api/esquema`. La raíz debe mostrar el panel; el archivo JavaScript debe responder correctamente; la API debe devolver JSON con el esquema de Monday. Si falta la clave, la página seguirá siendo visible y la API indicará el error de configuración.

La web se sirve directamente desde `public/`. Solo las rutas `/api/*` se reescriben a la función `api/index.mjs`. La caché de analíticas de Monday usa el directorio temporal en Vercel; cada instancia puede regenerarla cuando sea necesario.
