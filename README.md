# Sharp

HFS plugin offering *sharp* and *level-db* libraries to other plugins.

Use *sharp* by calling `api.customApiCall('sharp', buffer)[0]`

Access *level* by calling `api.customApiCall('level')[0]`

## Eseguire comandi Sharp in un processo separato

Per delegare una pipeline Sharp ad un processo figlio ed ottenere il risultato come `Buffer`, usa la funzione `runSharpCommands`:

```js
const [runSharpCommands] = await api.customApiCall('runSharpCommands')

const buffer = await runSharpCommands(imageBuffer, [
    ['resize', width, height, { fit: 'inside' }],
    ['rotate'],
    ['jpeg', { quality: 80 }],
])
```

Ogni operazione è un array composto dal nome del metodo Sharp seguito dagli argomenti da passare. Il worker esegue sempre `toBuffer()` al termine e restituisce il risultato nella promise.

Per liberare il processo dedicato (ad esempio in fase di shutdown) puoi invocare:

```js
const [disposeSharpWorker] = await api.customApiCall('disposeSharpWorker')
disposeSharpWorker()
```
