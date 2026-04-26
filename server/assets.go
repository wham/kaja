package assets

import "github.com/wham/kaja/v2/internal/ui"

// MonacoWorkerNames lists the Monaco worker names served by ReadMonacoWorker.
// Re-exported so external packages (e.g. the desktop binary) can iterate without
// importing the internal/ui package.
var MonacoWorkerNames = ui.MonacoWorkerNames
