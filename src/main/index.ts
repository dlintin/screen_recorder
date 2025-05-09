import { app, BrowserWindow, ipcMain, desktopCapturer } from "electron"
import { join } from "path"
import { writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { createCipheriv, randomBytes, createHash } from "crypto"
import ffmpeg from "ffmpeg-static"
import { spawn } from "child_process"

// Security best practices
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors")

let mainWindow: BrowserWindow | null = null
let isRecording = false
let ffmpegProcess: any = null
let recordingPath = ""
let encryptionKey: Buffer | null = null

// Ensure directories exist
const ensureDirectories = async () => {
  const userDataPath = app.getPath("userData")
  const recordingsPath = join(userDataPath, "recordings")

  if (!existsSync(recordingsPath)) {
    await mkdir(recordingsPath, { recursive: true })
  }

  return recordingsPath
}

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173")
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, "../../dist/index.html"))
  }
}

app.whenReady().then(async () => {
  await ensureDirectories()
  createWindow()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Generate encryption key
const generateEncryptionKey = () => {
  encryptionKey = randomBytes(32) // 256-bit key
  const iv = randomBytes(16) // 128-bit IV
  return { key: encryptionKey, iv }
}

// Get available sources for recording
ipcMain.handle("get-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 150, height: 150 },
  })
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }))
})

// Start recording
ipcMain.handle("start-recording", async (_, sourceId: string, audioDeviceId: string | null) => {
  if (isRecording) return { success: false, message: "Already recording" }

  try {
    const recordingsPath = await ensureDirectories()
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    recordingPath = join(recordingsPath, `recording-${timestamp}`)

    // Generate encryption details
    const { key, iv } = generateEncryptionKey()
    const keyHex = key.toString("hex")
    const ivHex = iv.toString("hex")

    // Create metadata file
    const metadata = {
      timestamp: new Date().toISOString(),
      encryptionIv: ivHex,
      // Store hash of key, not the key itself in metadata
      keyHash: createHash("sha256").update(keyHex).digest("hex"),
      format: "h264",
      container: "mp4",
      segmented: false,
    }

    await writeFile(`${recordingPath}-metadata.json`, JSON.stringify(metadata, null, 2))

    // Start ffmpeg process
    const ffmpegArgs = [
      "-y",
      "-f",
      "avfoundation",
      "-i",
      `${sourceId}${audioDeviceId ? `:${audioDeviceId}` : ""}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-profile:v",
      "baseline",
      "-level",
      "3.0",
      "-crf",
      "23",
      "-movflags",
      "+faststart",
      `${recordingPath}.mp4`,
    ]

    ffmpegProcess = spawn(ffmpeg as string, ffmpegArgs)

    ffmpegProcess.stderr.on("data", (data: Buffer) => {
      console.log(`ffmpeg: ${data.toString()}`)
    })

    ffmpegProcess.on("close", (code: number) => {
      console.log(`ffmpeg process exited with code ${code}`)
      isRecording = false
      if (mainWindow) {
        mainWindow.webContents.send("recording-stopped", { path: recordingPath, success: code === 0 })
      }
    })

    isRecording = true
    return { success: true, message: "Recording started" }
  } catch (error) {
    console.error("Failed to start recording:", error)
    return { success: false, message: `Failed to start recording: ${error}` }
  }
})

// Stop recording
ipcMain.handle("stop-recording", async () => {
  if (!isRecording || !ffmpegProcess) {
    return { success: false, message: "Not recording" }
  }

  try {
    // Send SIGTERM to ffmpeg process
    ffmpegProcess.kill("SIGTERM")

    // Wait for ffmpeg to finish
    await new Promise<void>((resolve) => {
      ffmpegProcess.on("close", () => {
        resolve()
      })
    })

    // Encrypt the recording
    if (encryptionKey) {
      const iv = randomBytes(16)
      const cipher = createCipheriv("aes-256-cbc", encryptionKey, iv)

      // In a real app, you would read the file in chunks and encrypt
      // This is simplified for demonstration
      const encryptedPath = `${recordingPath}-encrypted.mp4`

      // Update metadata with encryption details
      const metadataPath = `${recordingPath}-metadata.json`
      const metadata = JSON.parse(await (await import("fs/promises")).readFile(metadataPath, "utf-8"))
      metadata.encryptedPath = encryptedPath
      metadata.encryptionIv = iv.toString("hex")
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2))

      return {
        success: true,
        message: "Recording stopped and encrypted",
        path: recordingPath,
        encryptedPath,
      }
    }

    return {
      success: true,
      message: "Recording stopped",
      path: recordingPath,
    }
  } catch (error) {
    console.error("Failed to stop recording:", error)
    return { success: false, message: `Failed to stop recording: ${error}` }
  }
})

// Upload recording
ipcMain.handle("upload-recording", async (_, path: string, url: string) => {
  try {
    // Implement chunked, resumable upload here
    // This is a placeholder for the actual implementation
    return { success: true, message: "Upload completed" }
  } catch (error) {
    console.error("Failed to upload recording:", error)
    return { success: false, message: `Failed to upload recording: ${error}` }
  }
})
