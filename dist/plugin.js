exports.version = 1.2
exports.description = "Thumbnails engine. Install this and then the thumbnails plugin."
exports.apiRequired = 8.21 // customApi
exports.repo = "rejetto/sharp"

exports.customApi = {
    sharp: require('sharp'),
    level: () => require('level'),
}
