// Main Electron file for screen recorder
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

// Register IPC handlers only once
// Handle desktop capturer
ipcMain.handle('DESKTOP_CAPTURER_GET_SOURCES', async (event, opts) => {
  const sources = await desktopCapturer.getSources(opts);
  return sources;
});

// Handle get screen resolutions
ipcMain.handle('GET_SCREEN_RESOLUTIONS', async () => {
  try {
    const displays = screen.getAllDisplays();
    console.log('Available displays:', JSON.stringify(displays, null, 2));
    
    const resolutions = displays.map(display => {
      const { width, height } = display.bounds || display.size || display;
      const scaleFactor = display.scaleFactor || 1;
      
      // Calculate real dimensions accounting for scale factor
      const scaledWidth = Math.round(width * scaleFactor);
      const scaledHeight = Math.round(height * scaleFactor);
      
      console.log(`Display: ${width}x${height} with scale factor ${scaleFactor} = ${scaledWidth}x${scaledHeight}`);
      
      // Simple fixed aspect ratio calculation
      let aspectRatio = '16:9'; // Default
      
      // Calculate approximate aspect ratio
      const ratio = width / height;
      if (ratio > 1.7 && ratio < 1.8) {
        aspectRatio = '16:9';
      } else if (ratio > 1.3 && ratio < 1.4) {
        aspectRatio = '4:3';
      } else if (ratio > 1.5 && ratio < 1.6) {
        aspectRatio = '3:2';
      } else if (ratio > 2.3 && ratio < 2.4) {
        aspectRatio = '21:9';
      } else {
        // Calculate precise aspect ratio
        aspectRatio = calculateAspectRatio(width, height);
      }
      
      // Ensure height is even (required by x264)
      const evenHeight = height % 2 === 0 ? height : height - 1;
      
      return {
        width,
        height: evenHeight,
        scaleFactor,
        aspectRatio,
        label: `${width}×${evenHeight} (${aspectRatio}) - Native`
      };
    });
    
    console.log('Available screen resolutions:', resolutions);
    return resolutions;
  } catch (error) {
    console.error('Error getting screen resolutions:', error);
    return [];
  }
});

// Handle save dialog
ipcMain.handle('show-save-dialog', async (event, { format }) => {
  const result = await dialog.showSaveDialog({
    buttonLabel: 'Save video',
    defaultPath: `recording-${Date.now()}.${format}`,
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] },
      { name: 'MKV Video', extensions: ['mkv'] },
      { name: 'WebM Video', extensions: ['webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result;
});

// Handle file saving and conversion
ipcMain.handle('save-file', async (event, { filePath, buffer, format, resolution, bitrate, preserveAspectRatio }) => {
  let tempPath = null;
  try {
    // Check if buffer is valid and has data
    if (!buffer || buffer.byteLength === 0) {
      console.error('Error: Empty buffer received');
      return { success: false, error: 'No recording data received. The recording may be empty.' };
    }
    
    // Generate a unique temporary file path
    tempPath = path.join(app.getPath('temp'), `temp-${Date.now()}.webm`);
    console.log(`Saving temp file to: ${tempPath}`);
    
    // Write the buffer to the temp file
    await fs.writeFile(tempPath, Buffer.from(buffer));
    
    // Log file size for debugging
    const stats = await fs.stat(tempPath);
    console.log(`Temp file size: ${stats.size} bytes`);
    
    // Verify the temp file has actual content
    if (stats.size === 0) {
      return { success: false, error: 'Recording file is empty.' };
    }
    
    // If we're saving as WebM, just copy the file
    if (format === 'webm') {
      await fs.copyFile(tempPath, filePath);
      console.log(`WebM file saved to: ${filePath}`);
      return { success: true };
    }
    
    // Parse resolution
    let width = 1920;
    let height = 1080;
    if (resolution) {
      const dims = resolution.split('x');
      if (dims.length === 2) {
        width = parseInt(dims[0], 10);
        height = parseInt(dims[1], 10);
        // Ensure height is even (required by x264)
        height = height % 2 === 0 ? height : height - 1;
      }
    }
    
    // Calculate video bitrate
    const videoBitrate = bitrate ? Math.floor(bitrate / 1000) : 5000; // Convert to kbps
    
    // Get input video information (actual recorded dimensions)
    const inputInfo = await getVideoInfo(tempPath);
    const inputWidth = inputInfo.width || 1920;
    const inputHeight = inputInfo.height || 1080;
    const inputAspectRatio = inputInfo.displayAspectRatio || (inputWidth / inputHeight);
    
    console.log(`Input video dimensions: ${inputWidth}x${inputHeight} with aspect ratio ${inputAspectRatio}`);
    console.log(`Target dimensions: ${width}x${height} with preserve ratio: ${preserveAspectRatio}`);
    
    // Configure scaling filter based on aspect ratio preservation option
    let scaleFilter;
    
    if (preserveAspectRatio) {
      // Calculate scaling parameters to maintain aspect ratio
      // Using the built-in FFmpeg aspect ratio preservation
      scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
      console.log(`Scaling with preserved aspect ratio: ${scaleFilter}`);
    } else {
      // Direct scaling (may stretch content)
      scaleFilter = `scale=${width}:${height}`;
      console.log(`Scaling to exact dimensions (may stretch): ${scaleFilter}`);
    }
    
    // Otherwise, use FFmpeg to convert
    console.log(`Converting to ${format} with resolution ${width}x${height} at ${videoBitrate}kbps...`);
    await new Promise((resolve, reject) => {
      // Create and configure the FFmpeg command
      const command = ffmpeg()
        .input(tempPath)
        .inputOptions(['-fflags', '+genpts'])
        .videoBitrate(videoBitrate)
        .videoFilters(scaleFilter)
        .output(filePath)
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '22',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart'
        ]);
        
      // Set up logging
      command.on('start', cmdline => {
        console.log(`FFmpeg command: ${cmdline}`);
      });
      
      command.on('progress', progress => {
        console.log(`FFmpeg progress: ${JSON.stringify(progress)}`);
      });
      
      command.on('stderr', stderrLine => {
        console.log(`FFmpeg stderr: ${stderrLine}`);
      });
      
      // Handle completion
      command.on('end', () => {
        console.log('FFmpeg conversion complete');
        resolve();
      });
      
      // Handle errors
      command.on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      });
      
      // Run the command
      command.run();
    });
    
    console.log(`File saved to: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error('Error in save-file:', error);
    return { success: false, error: error.message };
  } finally {
    // Clean up temp file
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
        console.log('Temp file deleted');
      } catch (err) {
        console.error('Error deleting temp file:', err);
      }
    }
  }
});

// Helper function to get video information using ffmpeg
async function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Error probing video:', err);
        return resolve({ width: 1920, height: 1080 }); // Safe fallback
      }
      
      try {
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (videoStream) {
          // Log the full video stream info for debugging
          console.log('Video stream details:', JSON.stringify(videoStream, null, 2));
          
          // Extract values properly
          const width = videoStream.width || 1920;
          const height = videoStream.height || 1080;
          
          // Parse display_aspect_ratio if available (e.g. "16:9")
          let displayAspectRatio = null;
          if (videoStream.display_aspect_ratio) {
            const [w, h] = videoStream.display_aspect_ratio.split(':').map(Number);
            if (w && h) {
              displayAspectRatio = w / h;
            }
          }
          
          // Calculate aspect ratio from dimensions if not available
          if (!displayAspectRatio) {
            displayAspectRatio = width / height;
          }
          
          return resolve({
            width: width,
            height: height,
            duration: videoStream.duration,
            displayAspectRatio: displayAspectRatio,
            pixelFormat: videoStream.pix_fmt
          });
        } else {
          console.warn('No video stream found in file');
          return resolve({ width: 1920, height: 1080 }); // Safe fallback
        }
      } catch (error) {
        console.error('Error parsing video metadata:', error);
        return resolve({ width: 1920, height: 1080 }); // Safe fallback
      }
    });
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    // Improved window styling with proper drag handling
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 10 },
    backgroundColor: '#1F2937', // Dark mode background color
    show: false // Don't show until ready
  });

  // Graceful loading
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // In development, load from localhost
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built app
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // No need to register IPC handlers here anymore - they're registered at the top level
}

// Helper function to calculate aspect ratio as a string (e.g. "16:9")
function calculateAspectRatio(width, height) {
  // Non-recursive GCD implementation to avoid stack overflow
  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    
    // Handle edge cases that could cause recursion problems
    if (a === 0) return b;
    if (b === 0) return a;
    
    // Use Euclidean algorithm with loop instead of recursion
    while (b !== 0) {
      let temp = b;
      b = a % b;
      a = temp;
    }
    
    return a;
  }
  
  const divisor = gcd(width, height);
  if (divisor === 0) return '16:9'; // Default fallback
  
  const ratioWidth = width / divisor;
  const ratioHeight = height / divisor;
  
  // Check if the ratio is reasonable, otherwise return a standard 16:9
  if (ratioWidth > 100 || ratioHeight > 100) {
    return '16:9';
  }
  
  return `${Math.round(ratioWidth)}:${Math.round(ratioHeight)}`;
}

app.whenReady().then(() => {
  createWindow();
  
  // Request screen capture permissions on macOS
  if (process.platform === 'darwin') {
    app.dock.hide();
    const { systemPreferences } = require('electron');
    systemPreferences.getMediaAccessStatus('screen');
    app.dock.show();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 