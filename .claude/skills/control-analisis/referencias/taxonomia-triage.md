# Taxonomía de triage (adaptada del harness TQA)

Fuentes:
- `tqa-uipath` 0.11.1: skill `troubleshoot-plus`, sus runbooks y el agente `troubleshooter`;
- estándar 09 (manejo de errores) y estándar 08 (Orchestrator y configuración);
- skill oficial `uipath-troubleshoot` 1.205.0, para el método causal.

Adaptada al monitoreo de producción.

## Categorías (`category`)

| Categoría | Señales típicas | Severidad orientativa |
|---|---|---|
| `login` | "login failed", credenciales inválidas, 401, acceso denegado | P2. Bloquea el lote completo. P1 si para un proceso crítico. |
| `selector` | UI element not found, selector inválido | P3. P2 si es repetido en todos los items, por un posible cambio de la app. |
| `app_down` | timeouts, 503, no se puede conectar | P2 si persiste más de una corrida; P3 si es aislado |
| `infrastructure` | robot o máquina no disponible, licencias, sesión, items abandonados | P3. P2 si no hay robots. |
| `configuration` | asset o cola inexistente, configuración faltante | P2. Suele aparecer después de un deploy. |
| `scheduling` | jobs en Pending demasiado tiempo, trigger deshabilitado, proceso que no corrió | P2 si hay SLA comprometido |
| `business` | excepciones de negocio por encima del baseline | P3. Rara vez requiere fix: suele ser un dato de origen. |
| `application` | excepción de sistema sin categoría más específica | P3 |
| `silent_failure` | job Successful con logs Fatal (quirk Q1 del framework TQA: GetTransactionData agota reintentos, loguea Fatal y el job termina Successful) | P2. **El estado del job no alcanza.** |
| `regression` | errores nuevos que aparecen después de un deploy | P2 |
| `deploy` | cambio de versión detectado | P4, informativo (`monitor`) |
| `monitoring` | la Torre de Control no pudo leer (credenciales vencidas, permisos) | P2 si falla el login |

## Business vs Application (estándar 09)

- **Business:** regla de negocio o condición de datos. Se decide en el Sub-Process. No consume reintentos de la cola.
- **Application/System:** falla técnica que sube al Handler o al REFramework. Consume reintentos (`RetryNo` lo maneja Orchestrator).
- **No confiar en la etiqueta del queue item.** Contrastarla con el código: si una "BusinessException" se lanza desde un Component, es una violación de capa. Se reporta como hallazgo aparte en el análisis.
- `MaxConsecutiveSystemExceptions` detiene el job. Si la configuración no tiene `ShouldMarkJobAsFaulted`, un fallo de inicialización puede terminar "Successful".

## Decisiones

| Decisión | Cuándo | En el tablero |
|---|---|---|
| `escalate` | Requiere que un humano actúe o decida: P1/P2, algo nuevo sin explicación en la memoria, una regla con `action: escalate` | Tarjeta en la bandeja + análisis previo |
| `notify` | Conviene que lo vean, pero no bloquea (P3/P4 nuevos) | Tarjeta de baja prioridad |
| `monitor` | Hay que vigilar la tendencia sin molestar (deploys, valores apenas sobre el umbral) | "No reportados" |
| `known` | La memoria de producción o una regla `known` dice que es esperado | "No reportados", con la cita |

## Orden de evidencia (runbook §1)

1. El job fallido y la **versión** que corrió. Dispatcher y Performer son procesos distintos en XAML.
2. El log completo del job, usando los marcadores Start/Finished para ubicar el paso.
3. Los queue items fallidos y su `ProcessingException`.
4. Los deploys recientes, para separar regresión de dato o entorno.
5. Redactar credenciales y PII **siempre**.
