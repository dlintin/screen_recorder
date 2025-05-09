/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    getSources: () => Promise<any[]>
    startRecording: (sourceId: string, audioDeviceId: string | null) => Promise<any>
    stopRecording: () => Promise<any>
    uploadRecording: (path: string, url: string) => Promise<any>
    onRecordingStopped: (callback: (event: any) => void) => () => void
  }
}
