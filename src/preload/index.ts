import { contextBridge, ipcRenderer } from "electron"

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  getSources: () => ipcRenderer.invoke("get-sources"),
  startRecording: (sourceId: string, audioDeviceId: string | null) =>
    ipcRenderer.invoke("start-recording", sourceId, audioDeviceId),
  stopRecording: () => ipcRenderer.invoke("stop-recording"),
  uploadRecording: (path: string, url: string) => ipcRenderer.invoke("upload-recording", path, url),
  onRecordingStopped: (callback: (event: any) => void) => {
    ipcRenderer.on("recording-stopped", (_, data) => callback(data))
    return () => {
      ipcRenderer.removeAllListeners("recording-stopped")
    }
  },
})
