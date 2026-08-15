exports.version = 1.3
exports.description = "Thumbnails engine. Install this and then the thumbnails plugin."
exports.apiRequired = 8.23 // customApiCall
exports.repo = "rejetto/sharp"
exports.changelog = [{ "version": 1.3, "message": "Fix: Stop timed-out Sharp work and isolate worker restarts" }]

exports.customApi = {
    sharp: require('sharp'),
    level: () => require('level'),
    runSharpCommands: require('./sharp-runner').runSharpCommands,
    disposeSharpWorker: require('./sharp-runner').disposeSharpWorker,
}
