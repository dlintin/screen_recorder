"use client"

import { useState, useEffect } from "react"
import "./App.css"

interface Source {
  id: string
  name: string
  thumbnail: string
}

interface RecordingState {
  isRecording: boolean
  duration: number
  path: string | null
}

function App() {
  const [sources, setSources] = useState<Source[]>([])
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string | null>(null)
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    duration: 0,
    path: null,
  })
  const [hasConsent, setHasConsent] = useState<boolean>(false)
  const [uploadStatus, setUploadStatus] = useState<string>("")

  // Load available sources
  useEffect(() => {
    const loadSources = async () => {
      try {
        const availableSources = await window.electronAPI.getSources()
        setSources(availableSources)
      } catch (error) {
        console.error("Failed to get sources:", error)
      }
    }

    loadSources()
  }, [])

  // Load audio devices
  useEffect(() => {
    const loadAudioDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices.filter((device) => device.kind === "audioinput")
        setAudioDevices(audioInputs)
      } catch (error) {
        console.error("Failed to get audio devices:", error)
      }
    }

    loadAudioDevices()
  }, [])

  // Set up recording timer
  useEffect(() => {
    let interval: number | null = null

    if (recordingState.isRecording) {
      interval = window.setInterval(() => {
        setRecordingState((prev) => ({
          ...prev,
          duration: prev.duration + 1,
        }))
      }, 1000)
    } else if (interval) {
      clearInterval(interval)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [recordingState.isRecording])

  // Listen for recording stopped event
  useEffect(() => {
    const unsubscribe = window.electronAPI.onRecordingStopped((data) => {
      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
        path: data.path,
      }))

      if (data.success) {
        console.log("Recording completed successfully:", data.path)
      } else {
        console.error("Recording failed")
      }
    })

    return unsubscribe
  }, [])

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const handleStartRecording = async () => {
    if (!selectedSource) {
      alert("Please select a source to record")
      return
    }

    if (!hasConsent) {
      alert("Please provide consent for recording")
      return
    }

    try {
      const result = await window.electronAPI.startRecording(selectedSource, selectedAudioDevice)

      if (result.success) {
        setRecordingState({
          isRecording: true,
          duration: 0,
          path: null,
        })
      } else {
        alert(`Failed to start recording: ${result.message}`)
      }
    } catch (error) {
      console.error("Failed to start recording:", error)
      alert("Failed to start recording")
    }
  }

  const handleStopRecording = async () => {
    try {
      const result = await window.electronAPI.stopRecording()

      if (result.success) {
        setRecordingState((prev) => ({
          ...prev,
          isRecording: false,
          path: result.path,
        }))
      } else {
        alert(`Failed to stop recording: ${result.message}`)
      }
    } catch (error) {
      console.error("Failed to stop recording:", error)
      alert("Failed to stop recording")
    }
  }

  const handleUpload = async () => {
    if (!recordingState.path) {
      alert("No recording to upload")
      return
    }

    setUploadStatus("Uploading...")

    try {
      // In a real app, you would get this URL from your server
      const uploadUrl = "https://example.com/upload"
      const result = await window.electronAPI.uploadRecording(recordingState.path, uploadUrl)

      if (result.success) {
        setUploadStatus("Upload completed successfully")
      } else {
        setUploadStatus(`Upload failed: ${result.message}`)
      }
    } catch (error) {
      console.error("Failed to upload recording:", error)
      setUploadStatus("Upload failed")
    }
  }

  return (
    <div className="app-container">
      <h1>AI-Ready Screen Recorder</h1>

      <div className="consent-section">
        <h2>Privacy Consent</h2>
        <label>
          <input type="checkbox" checked={hasConsent} onChange={(e) => setHasConsent(e.target.checked)} />I consent to
          recording my screen for AI processing purposes
        </label>
      </div>

      <div className="sources-section">
        <h2>Select Source</h2>
        <div className="sources-grid">
          {sources.map((source) => (
            <div
              key={source.id}
              className={`source-item ${selectedSource === source.id ? "selected" : ""}`}
              onClick={() => setSelectedSource(source.id)}
            >
              <img src={source.thumbnail || "/placeholder.svg"} alt={source.name} />
              <div className="source-name">{source.name}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="audio-section">
        <h2>Select Audio Input (Optional)</h2>
        <select value={selectedAudioDevice || ""} onChange={(e) => setSelectedAudioDevice(e.target.value || null)}>
          <option value="">No Audio</option>
          {audioDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Audio Input ${device.deviceId.substring(0, 5)}`}
            </option>
          ))}
        </select>
      </div>

      <div className="controls-section">
        {!recordingState.isRecording ? (
          <button className="start-button" onClick={handleStartRecording} disabled={!selectedSource || !hasConsent}>
            Start Recording
          </button>
        ) : (
          <div className="recording-controls">
            <div className="recording-indicator">
              <div className="recording-dot"></div>
              Recording: {formatDuration(recordingState.duration)}
            </div>
            <button className="stop-button" onClick={handleStopRecording}>
              Stop Recording
            </button>
          </div>
        )}
      </div>

      {recordingState.path && !recordingState.isRecording && (
        <div className="recording-result">
          <h2>Recording Completed</h2>
          <p>Recording saved to: {recordingState.path}</p>
          <button className="upload-button" onClick={handleUpload}>
            Upload for AI Processing
          </button>
          {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
        </div>
      )}
    </div>
  )
}

export default App
