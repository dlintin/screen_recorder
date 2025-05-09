'use client';

import { useState, useEffect, useRef } from 'react';

// Declare the window.electron type
declare global {
  interface Window {
    electron: {
      desktopCapturer: {
        getSources: (opts: { types: string[] }) => Promise<any[]>;
      };
      screenInfo: {
        getResolutions: () => Promise<NativeResolution[]>;
      };
      ipcRenderer: {
        invoke: (channel: string, data?: any) => Promise<any>;
      };
    };
  }
}

interface Source {
  id: string;
  name: string;
  thumbnail: Electron.NativeImage;
}

interface Resolution {
  width: number;
  height: number;
  label: string;
  aspectRatio?: string;
  isNative?: boolean;
}

interface NativeResolution {
  width: number;
  height: number;
  scaleFactor: number;
  aspectRatio: string;
  label: string;
  isNative?: boolean;
}

interface BitrateOption {
  value: number;
  label: string;
}

const formatTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const VIDEO_FORMATS = [
  { value: 'mp4', label: 'MP4 (H.264)', description: 'Best for AI processing and general compatibility' },
  { value: 'mkv', label: 'MKV (H.264)', description: 'Good for high-quality recordings with smaller file size' },
  { value: 'webm', label: 'WebM (VP8)', description: 'Original format, good web compatibility' },
];

// Standard resolution options
const DEFAULT_RESOLUTIONS: Resolution[] = [
  { width: 3840, height: 2160, label: '4K (3840×2160)', aspectRatio: '16:9' },
  { width: 2560, height: 1440, label: '2K (2560×1440)', aspectRatio: '16:9' },
  { width: 1920, height: 1080, label: 'Full HD (1920×1080)', aspectRatio: '16:9' },
  { width: 1280, height: 720, label: 'HD (1280×720)', aspectRatio: '16:9' },
  { width: 854, height: 480, label: 'SD (854×480)', aspectRatio: '16:9' },
];

const BITRATE_OPTIONS: BitrateOption[] = [
  { value: 12000000, label: 'High (12 Mbps) - Best quality' },
  { value: 8000000, label: 'Medium (8 Mbps) - Good balance' },
  { value: 5000000, label: 'Standard (5 Mbps) - Recommended' },
  { value: 2500000, label: 'Low (2.5 Mbps) - Smaller file size' },
];

// Use the most widely supported format for recording
const RECORDING_MIME_TYPE = 'video/webm;codecs=vp8';

const MIME_TYPES = {
  'mp4': 'video/webm;codecs=vp8',
  'mkv': 'video/webm;codecs=vp8',
  'webm': 'video/webm;codecs=vp8'
};

const App = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [recordingTime, setRecordingTime] = useState(0);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [selectedFormat, setSelectedFormat] = useState('mp4');
  const [selectedResolution, setSelectedResolution] = useState<Resolution>(DEFAULT_RESOLUTIONS[2]); // Default to 1080p
  const [selectedBitrate, setSelectedBitrate] = useState<BitrateOption>(BITRATE_OPTIONS[2]); // Default to 5 Mbps
  const [isDarkMode, setIsDarkMode] = useState(true); // Default to dark mode
  const [resolutions, setResolutions] = useState<Resolution[]>(DEFAULT_RESOLUTIONS);
  const [preserveAspectRatio, setPreserveAspectRatio] = useState(true); // Default to preserving aspect ratio
  const timerInterval = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentStreamSource = useRef<string | null>(null);
  
  useEffect(() => {
    // Get available recording sources
    const getSources = async () => {
      const sources = await window.electron.desktopCapturer.getSources({
        types: ['window', 'screen']
      });
      setSources(sources);
    };
    getSources();

    // Get available screen resolutions
    const getScreenResolutions = async () => {
      try {
        const nativeResolutions = await window.electron.screenInfo.getResolutions();
        
        if (nativeResolutions && nativeResolutions.length > 0) {
          console.log('Native screen resolutions:', nativeResolutions);
          
          // Convert to Resolution format and merge with default resolutions
          const nativeRes = nativeResolutions.map(res => ({
            ...res,
            isNative: true
          }));
          
          // Merge and sort by resolution (height)
          const allResolutions = [...nativeRes, ...DEFAULT_RESOLUTIONS]
            // Remove duplicates based on exact dimension match
            .filter((res, index, self) => 
              index === self.findIndex(r => 
                r.width === res.width && r.height === res.height
              )
            )
            .sort((a, b) => b.height - a.height);
            
          setResolutions(allResolutions);
          
          // Set the first native resolution as default for better initial capture
          const firstNative = nativeRes[0];
          if (firstNative) {
            console.log(`Setting default resolution to native: ${firstNative.width}x${firstNative.height}`);
            setSelectedResolution(firstNative);
          }
        }
      } catch (error) {
        console.error('Error fetching screen resolutions:', error);
      }
    };
    
    getScreenResolutions();

    // Cleanup timer on unmount
    return () => {
      if (timerInterval.current) {
        window.clearInterval(timerInterval.current);
      }
    };
  }, []);

  // Set up the stream with current resolution whenever selectedSource or selectedResolution changes
  useEffect(() => {
    if (selectedSource && !isRecording) {
      setupStream(selectedSource);
    }
  }, [selectedResolution, selectedSource]);
  
  const setupStream = async (source: Source) => {
    try {
      console.log(`Setting up stream for source: ${source.name} with resolution: ${selectedResolution.width}x${selectedResolution.height}`);
      
      // Determine if we're using native resolution
      const isNativeResolution = selectedResolution.isNative;
      
      console.log(`Using ${isNativeResolution ? 'native' : 'standard'} resolution with ${preserveAspectRatio ? 'preserved' : 'stretched'} aspect ratio`);
      
      // Set up constraints based on whether we're using native resolution or not
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id,
          } as any
        }
      };
      
      // For non-native resolutions, we need to apply the specific resolution constraints
      // For native resolutions, we let the system use the screen's actual resolution
      if (!isNativeResolution) {
        (constraints.video as any).mandatory = {
          ...(constraints.video as any).mandatory,
          minWidth: selectedResolution.width,
          maxWidth: selectedResolution.width,
          minHeight: selectedResolution.height,
          maxHeight: selectedResolution.height
        };
      } else {
        // For native resolutions, we don't constrain dimensions
        console.log('Using native screen dimensions without constraints');
      }
      
      console.log('Getting user media with constraints:', JSON.stringify(constraints, null, 2));
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log(`Stream obtained with ${stream.getVideoTracks().length} video tracks`);
      
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        console.log('Video track settings:', settings);
        console.log(`Actual stream dimensions: ${settings.width}x${settings.height}`);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          console.log(`Preview dimensions: ${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`);
          videoRef.current?.play();
        };
      }

      // Store recorded chunks
      const chunks: Blob[] = [];
      
      // Create the media recorder with selected bitrate
      const recorder = new MediaRecorder(stream, {
        mimeType: RECORDING_MIME_TYPE,
        videoBitsPerSecond: selectedBitrate.value
      });
      
      setMediaRecorder(recorder);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          console.log(`Chunk received: ${e.data.size} bytes`);
          chunks.push(e.data);
          setRecordedChunks(prev => [...prev, e.data]);
        }
      };

      recorder.onstop = async () => {
        try {
          if (chunks.length === 0) {
            console.error('No recording chunks collected');
            setSaveStatus('Error: No recording data collected');
            return;
          }
          
          setSaveStatus('Processing recording...');
          
          // Create a Blob with the correct MIME type
          const blob = new Blob(chunks, {
            type: RECORDING_MIME_TYPE
          });
          
          console.log(`Recording size: ${blob.size} bytes`);
          
          if (blob.size === 0) {
            setSaveStatus('Error: Recording is empty');
            return;
          }

          const buffer = await blob.arrayBuffer();
          const result = await window.electron.ipcRenderer.invoke('show-save-dialog', {
            format: selectedFormat
          });

          if (result.filePath) {
            setSaveStatus(`Saving and converting to ${selectedFormat.toUpperCase()}...`);
            const saveResult = await window.electron.ipcRenderer.invoke('save-file', {
              filePath: result.filePath,
              buffer: buffer,
              format: selectedFormat,
              resolution: `${selectedResolution.width}x${selectedResolution.height}`,
              bitrate: selectedBitrate.value,
              preserveAspectRatio: preserveAspectRatio
            });

            if (saveResult.success) {
              setSaveStatus(`Recording saved successfully to: ${result.filePath}`);
            } else {
              setSaveStatus(`Error saving recording: ${saveResult.error}`);
            }
          } else {
            setSaveStatus('Save cancelled');
          }
        } catch (error) {
          console.error('Error saving recording:', error);
          setSaveStatus('Error saving recording');
        }
      };

      currentStreamSource.current = source.id;
    } catch (e) {
      console.error('Error setting up stream:', e);
      setSaveStatus('Error setting up stream');
    }
  };

  const handleSourceSelect = async (sourceIndex: string) => {
    const source = sources[parseInt(sourceIndex)];
    if (!source) return;
    
    setSelectedSource(source);
    // setupStream will be called by the useEffect
  };

  const startRecording = () => {
    if (mediaRecorder) {
      setRecordedChunks([]);
      setRecordingTime(0);
      setSaveStatus('');
      
      // Capture chunks more frequently (every 200ms)
      mediaRecorder.start(200);
      console.log('Recording started');
      setIsRecording(true);

      // Start timer
      timerInterval.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setIsRecording(false);
      
      // Stop timer
      if (timerInterval.current) {
        window.clearInterval(timerInterval.current);
        timerInterval.current = null;
      }
    }
  };

  // Toggle dark mode class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  return (
    <div className={`min-h-screen transition-colors duration-200 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
      {/* Custom draggable titlebar */}
      <div className="app-drag-region h-8 w-full fixed top-0 left-0 z-50" style={{ WebkitAppRegion: 'drag' }}></div>
      
      <div className="container mx-auto px-4 py-4 max-w-5xl mt-4">
        <header className="flex justify-between items-center mb-4 pt-2">
          <h1 className="text-xl font-bold">Screen Recorder</h1>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-1.5 rounded-full ${isDarkMode ? 'bg-gray-700 text-yellow-400' : 'bg-gray-200 text-gray-800'}`}
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
        </header>
      
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-3">
            {/* Preview Area */}
            <div className={`relative mb-3 border rounded-lg overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
              <video ref={videoRef} className="w-full h-auto aspect-video bg-black" muted />
              {isRecording && (
                <div className="absolute top-3 right-3 bg-red-500 text-white px-2 py-0.5 rounded-full flex items-center gap-1.5 text-sm">
                  <span className="animate-pulse h-2 w-2 rounded-full bg-white inline-block"></span>
                  {formatTime(recordingTime)}
                </div>
              )}
              {!selectedSource && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 text-white">
                  <p>Select a source to see preview</p>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={startRecording}
                disabled={!selectedSource || isRecording}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                  !selectedSource || isRecording 
                    ? 'opacity-50 cursor-not-allowed' 
                    : 'hover:bg-green-600'
                } bg-green-500 text-white`}
              >
                Start Recording
              </button>
              <button
                onClick={stopRecording}
                disabled={!isRecording}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                  !isRecording 
                    ? 'opacity-50 cursor-not-allowed' 
                    : 'hover:bg-red-600'
                } bg-red-500 text-white`}
              >
                Stop Recording
              </button>
            </div>

            {/* Status Message */}
            {saveStatus && (
              <div className={`mt-3 p-3 rounded-lg text-sm ${
                saveStatus.includes('successfully') 
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                  : saveStatus.includes('Error') 
                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
              }`}>
                {saveStatus}
              </div>
            )}
          </div>

          <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
            <h2 className="text-lg font-semibold mb-3">Settings</h2>
            
            {/* Compact Settings Layout */}
            <div className="space-y-3">
              {/* Source Selection */}
              <div>
                <label className="block text-xs font-medium mb-1">Source</label>
                <select
                  onChange={(e) => handleSourceSelect(e.target.value)}
                  disabled={isRecording}
                  className={`w-full p-1.5 text-sm rounded ${
                    isDarkMode 
                      ? 'bg-gray-700 border-gray-600 text-white' 
                      : 'bg-white border-gray-300 text-gray-900'
                  } border`}
                >
                  <option value="">Select a source</option>
                  {sources.map((source, index) => (
                    <option key={source.id} value={index}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Resolution Selection */}
              <div>
                <label className="block text-xs font-medium mb-1">Resolution</label>
                <select
                  value={`${selectedResolution.width}x${selectedResolution.height}`}
                  onChange={(e) => {
                    const [width, height] = e.target.value.split('x').map(Number);
                    const resolution = resolutions.find(r => r.width === width && r.height === height);
                    if (resolution) setSelectedResolution(resolution);
                  }}
                  disabled={isRecording}
                  className={`w-full p-1.5 text-sm rounded ${
                    isDarkMode 
                      ? 'bg-gray-700 border-gray-600 text-white' 
                      : 'bg-white border-gray-300 text-gray-900'
                  } border`}
                >
                  {resolutions.map(res => (
                    <option 
                      key={`${res.width}x${res.height}${res.isNative ? '-native' : ''}`} 
                      value={`${res.width}x${res.height}`}
                      className={res.isNative ? 'font-medium' : ''}
                    >
                      {res.label}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Aspect Ratio Preservation Toggle */}
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium">Preserve Aspect Ratio</label>
                <div 
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    preserveAspectRatio 
                      ? 'bg-green-500' 
                      : isDarkMode ? 'bg-gray-600' : 'bg-gray-300'
                  }`}
                  onClick={() => !isRecording && setPreserveAspectRatio(!preserveAspectRatio)}
                  style={{ cursor: isRecording ? 'not-allowed' : 'pointer' }}
                >
                  <span 
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      preserveAspectRatio ? 'translate-x-6' : 'translate-x-1'
                    }`} 
                  />
                </div>
              </div>
              
              <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {preserveAspectRatio 
                  ? "Maintain source aspect ratio (adds black bars if needed)" 
                  : "Stretch to target resolution (may distort content)"}
              </div>
              
              {/* Bitrate Selection */}
              <div>
                <label className="block text-xs font-medium mb-1">Video Quality</label>
                <select
                  value={selectedBitrate.value}
                  onChange={(e) => {
                    const bitrate = BITRATE_OPTIONS.find(b => b.value === Number(e.target.value));
                    if (bitrate) setSelectedBitrate(bitrate);
                  }}
                  disabled={isRecording}
                  className={`w-full p-1.5 text-sm rounded ${
                    isDarkMode 
                      ? 'bg-gray-700 border-gray-600 text-white' 
                      : 'bg-white border-gray-300 text-gray-900'
                  } border`}
                >
                  {BITRATE_OPTIONS.map(bitrate => (
                    <option key={bitrate.value} value={bitrate.value}>
                      {bitrate.label}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Format Selection */}
              <div>
                <label className="block text-xs font-medium mb-1">Output Format</label>
                <select
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                  disabled={isRecording}
                  className={`w-full p-1.5 text-sm rounded ${
                    isDarkMode 
                      ? 'bg-gray-700 border-gray-600 text-white' 
                      : 'bg-white border-gray-300 text-gray-900'
                  } border`}
                >
                  {VIDEO_FORMATS.map(format => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </select>
                <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {VIDEO_FORMATS.find(f => f.value === selectedFormat)?.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
