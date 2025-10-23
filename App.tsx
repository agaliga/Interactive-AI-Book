import React, { useState, useRef, useCallback, useEffect } from 'react';
import { recognizeImage, generateColoringPageImage, generateStory, generateSpeech, startVideoGeneration, checkVideoOperationStatus, generateStoryImage } from './services/geminiService';
import { useDrawingCanvas } from './hooks/useDrawingCanvas';
import { useColoringCanvas } from './hooks/useColoringCanvas';
import { Spinner } from './components/Spinner';
import { MessageBox } from './components/MessageBox';
import { PaintBrushIcon, SparklesIcon, BookOpenIcon, SpeakerWaveIcon, StopIcon, SpeakerXMarkIcon, ButtonSpinner, FilmIcon, XMarkIcon } from './components/Icons';
import { Operation } from '@google/genai';

// Helper function to decode base64 string to Uint8Array
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper function to decode raw PCM audio data into an AudioBuffer
async function decodePcmAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

interface HistoryItem {
    id: number;
    userDrawingDataUrl: string;
    recognizedText: string;
    generatedImage: string;
    coloredImageDataUrl?: string;
    storyText: string | null;
    speechData?: string;
    videoApiUri?: string;
    storyImageDataUrl?: string;
}


const App: React.FC = () => {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isGeneratingStory, setIsGeneratingStory] = useState<boolean>(false);
    const [isGeneratingVideo, setIsGeneratingVideo] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [recognizedText, setRecognizedText] = useState<string>('');
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [selectedColor, setSelectedColor] = useState<string>('#FF6347');
    const [storyText, setStoryText] = useState<string | null>(null);
    const [isStoryMode, setIsStoryMode] = useState<boolean>(false);
    const [userDrawingDataUrl, setUserDrawingDataUrl] = useState<string | null>(null);
    const [isReading, setIsReading] = useState<boolean>(false);
    const [isGeneratingStoryAssets, setIsGeneratingStoryAssets] = useState<boolean>(false);
    
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);
    const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);

    const [isMusicPlaying, setIsMusicPlaying] = useState<boolean>(false);
    const [isMusicLoading, setIsMusicLoading] = useState<boolean>(false);

    const userCanvasRef = useRef<HTMLCanvasElement>(null);
    const aiCanvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    
    // Refs for text-to-speech audio
    const speechAudioContextRef = useRef<AudioContext | null>(null);
    const speechSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const audioJobIdRef = useRef<number>(0);
    const videoUrlCache = useRef(new Map<string, string>());

    // Refs for background music
    const musicAudioContextRef = useRef<AudioContext | null>(null);
    const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const musicGainNodeRef = useRef<GainNode | null>(null);
    const musicBufferRef = useRef<AudioBuffer | null>(null);


    const { clearCanvas, isCanvasBlank } = useDrawingCanvas(userCanvasRef);

    const activeItem = history.find(h => h.id === activeHistoryId);

    const handleOnColor = useCallback(() => {
        if (aiCanvasRef.current && activeHistoryId) {
            const coloredDataUrl = aiCanvasRef.current.toDataURL('image/png');
            setHistory(prev => {
                const newHistory = prev.map(item =>
                    item.id === activeHistoryId ? { ...item, coloredImageDataUrl: coloredDataUrl } : item
                );
                try {
                    localStorage.setItem('coloringBookHistory', JSON.stringify(newHistory));
                } catch (e) {
                    console.error("Failed to save history to localStorage", e);
                    setError("Could not save your coloring progress. The browser storage might be full.");
                }
                return newHistory;
            });
        }
    }, [activeHistoryId]);

    const { clearColoring: clearColoringCanvas } = useColoringCanvas(
        aiCanvasRef,
        generatedImage,
        selectedColor,
        activeItem?.coloredImageDataUrl,
        handleOnColor
    );

    const handleClearColoring = () => {
        clearColoringCanvas();
        if (activeHistoryId) {
            setHistory(prev => {
                const newHistory = prev.map(item => {
                    if (item.id === activeHistoryId) {
                        const { coloredImageDataUrl, ...rest } = item;
                        return rest;
                    }
                    return item;
                });
                try {
                    localStorage.setItem('coloringBookHistory', JSON.stringify(newHistory));
                } catch (e) {
                    console.error("Failed to save history to localStorage", e);
                    setError("Could not save your changes. The browser storage might be full.");
                }
                return newHistory;
            });
        }
    };


    const colors = [
        '#FF6347', '#FFD700', '#ADFF2F', '#1E90FF', '#9370DB',
        '#FF69B4', '#FFA500', '#00CED1', '#808080', '#FFFFFF',
    ];

    // Load history from localStorage on initial render
    useEffect(() => {
        try {
            const savedHistory = localStorage.getItem('coloringBookHistory');
            if (savedHistory) {
                setHistory(JSON.parse(savedHistory));
            }
        } catch (e) {
            console.error("Failed to load history from localStorage", e);
            localStorage.removeItem('coloringBookHistory');
        }
    }, []);


    const stopMusic = useCallback(() => {
        if (musicSourceRef.current) {
            musicSourceRef.current.stop();
            musicSourceRef.current.disconnect();
            musicSourceRef.current = null;
        }
        setIsMusicPlaying(false);
    }, []);

    const stopSpeech = useCallback(() => {
        audioJobIdRef.current += 1;
        
        if (speechSourceRef.current) {
            speechSourceRef.current.stop();
            speechSourceRef.current.disconnect();
            speechSourceRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
        setVideoObjectUrl(null);
        
        setIsReading(false);
        stopMusic();
    }, [stopMusic]);
    
    const handleClearDrawing = () => {
        clearCanvas();
        setRecognizedText('');
        setGeneratedImage(null);
        setIsStoryMode(false);
        setStoryText(null);
        setUserDrawingDataUrl(null);
        setActiveHistoryId(null);
        setVideoObjectUrl(null);
        stopSpeech();
    };

    const handleGenerate = useCallback(async () => {
        if (isCanvasBlank()) {
            setError("Please draw something on the canvas first!");
            return;
        }
        setIsLoading(true);
        setError(null);
        setRecognizedText('');
        setGeneratedImage(null);
        setIsStoryMode(false);
        setStoryText(null);
        stopSpeech();

        try {
            const canvas = userCanvasRef.current;
            if (!canvas) throw new Error("Canvas not found");
            const imageDataUrl = canvas.toDataURL('image/png');
            const base64Data = imageDataUrl.split(',')[1];

            const text = await recognizeImage(base64Data);
            if (!text) {
                throw new Error("Could not recognize your drawing. Please try a clearer drawing.");
            }
            setRecognizedText(text);

            const newImageBase64 = await generateColoringPageImage(text);
            if (!newImageBase64) {
                throw new Error("Could not generate a coloring page. Please try again.");
            }
            setGeneratedImage(newImageBase64);
            
            const newUserDrawingUrl = canvas.toDataURL('image/png');
            const newHistoryItem: HistoryItem = {
                id: Date.now(),
                userDrawingDataUrl: newUserDrawingUrl,
                recognizedText: text,
                generatedImage: newImageBase64,
                storyText: null,
            };
            setHistory(prev => {
                const newHistory = [...prev, newHistoryItem];
                try {
                    localStorage.setItem('coloringBookHistory', JSON.stringify(newHistory));
                } catch (e) {
                    console.error("Failed to save history to localStorage", e);
                    setError("Creation saved, but failed to store in browser history. Storage might be full.");
                }
                return newHistory;
            });
            setActiveHistoryId(newHistoryItem.id);
            setUserDrawingDataUrl(newUserDrawingUrl);


        } catch (err) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    }, [isCanvasBlank, stopSpeech]);

    const handleGenerateStory = async () => {
        const activeItem = history.find(item => item.id === activeHistoryId);

        if (!activeItem) {
            setError("Cannot generate a story without a recognized drawing.");
            return;
        }

        if (activeItem.storyText) {
            setStoryText(activeItem.storyText);
            setIsStoryMode(true);
            return;
        }
        
        setIsGeneratingStory(true);
        setError(null);
        try {
            const story = await generateStory(activeItem.recognizedText);
            setStoryText(story);
            
            setHistory(prev => {
                const newHistory = prev.map(item => 
                    item.id === activeHistoryId ? { ...item, storyText: story } : item
                );
                try {
                    localStorage.setItem('coloringBookHistory', JSON.stringify(newHistory));
                } catch (e) {
                    console.error("Failed to save history to localStorage", e);
                    setError("Could not save the story to browser history. Storage might be full.");
                }
                return newHistory;
            });

            setIsStoryMode(true);
        } catch (err) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setError(errorMessage);
        } finally {
            setIsGeneratingStory(false);
        }
    };

    const handleGenerateVideo = async () => {
        const activeItem = history.find(item => item.id === activeHistoryId);
        if (!activeItem?.storyText) {
            setError("Please generate a story first.");
            return;
        }

        try {
            const hasKey = await (window as any).aistudio.hasSelectedApiKey();
            if (!hasKey) {
                setError("Please select an API key to generate videos.");
                await (window as any).aistudio.openSelectKey();
                // We optimistically assume the user selected a key.
            }
        } catch (e) {
            console.error("aistudio API not available", e);
            setError("Could not access AI Studio features. Please ensure you are in the correct environment.");
            return;
        }

        setIsGeneratingVideo(true);
        setError(null);
        
        try {
            let operation = await startVideoGeneration(activeItem.storyText);
            
            while (!operation.done) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                operation = await checkVideoOperationStatus(operation);
            }

            const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (!videoUri) {
                throw new Error("Video generation completed, but no video URL was found.");
            }

            setHistory(prev => {
                const newHistory = prev.map(item =>
                    item.id === activeHistoryId ? { ...item, videoApiUri: videoUri } : item
                );
                try {
                    localStorage.setItem('coloringBookHistory', JSON.stringify(newHistory));
                } catch (e) {
                    console.error("Failed to save history to localStorage", e);
                    setError("Could not save video info to browser history. Storage might be full.");
                }
                return newHistory;
            });

        } catch (err) {
            console.error(err);
            let errorMessage = err instanceof Error ? err.message : "An unknown error occurred while generating the video.";
            if (errorMessage.includes("Requested entity was not found")) {
                errorMessage = "Your API key is not valid for video generation. Please select a different key and try again.";
                 (window as any).aistudio.openSelectKey();
            }
            setError(errorMessage);
        } finally {
            setIsGeneratingVideo(false);
        }
    };
    
    const startMusic = useCallback(async () => {
        if (isMusicPlaying || isMusicLoading) {
            return;
        }
        setIsMusicLoading(true);
        setError(null);
        try {
            if (!musicAudioContextRef.current || musicAudioContextRef.current.state === 'closed') {
                musicAudioContextRef.current = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
                musicGainNodeRef.current = musicAudioContextRef.current.createGain();
                musicGainNodeRef.current.connect(musicAudioContextRef.current.destination);
            }
            const audioContext = musicAudioContextRef.current;
            await audioContext.resume();

            if (!musicBufferRef.current) {
                const response = await fetch('/pianoSound.mp3');
                if (!response.ok) throw new Error(`Failed to fetch music file: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                musicBufferRef.current = await audioContext.decodeAudioData(arrayBuffer);
            }

            if (musicSourceRef.current) {
                musicSourceRef.current.stop();
                musicSourceRef.current.disconnect();
            }

            const source = audioContext.createBufferSource();
            source.buffer = musicBufferRef.current;
            source.loop = true;
            source.connect(musicGainNodeRef.current!);
            musicGainNodeRef.current!.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.01);
            source.start();
            musicSourceRef.current = source;
            setIsMusicPlaying(true);
        } catch (err) {
            console.error("Failed to load or play music:", err);
            setError("Could not play background music.");
            setIsMusicPlaying(false);
        } finally {
            setIsMusicLoading(false);
        }
    }, [isMusicPlaying, isMusicLoading]);

    const handleReadStory = useCallback(async () => {
        if (isReading) {
            stopSpeech();
            return;
        }
        
        const activeItem = history.find(h => h.id === activeHistoryId);
        if (!activeItem?.storyText) return;

        const jobId = ++audioJobIdRef.current;

        const playAudioFromData = async (speechData: string) => {
            setIsReading(true);
            setError(null);
            try {
                if (jobId !== audioJobIdRef.current) { setIsReading(false); return; }

                if (activeItem.videoApiUri) {
                    let objectUrl = videoUrlCache.current.get(activeItem.videoApiUri);
                    if (!objectUrl) {
                        const videoResponse = await fetch(`${activeItem.videoApiUri}&key=${process.env.API_KEY}`);
                        if (!videoResponse.ok) throw new Error("Failed to fetch video data.");
                        const videoBlob = await videoResponse.blob();
                        objectUrl = URL.createObjectURL(videoBlob);
                        videoUrlCache.current.set(activeItem.videoApiUri, objectUrl);
                    }
                    setVideoObjectUrl(objectUrl);
                    videoRef.current?.play();
                }

                if (!speechAudioContextRef.current || speechAudioContextRef.current.state === 'closed') {
                    speechAudioContextRef.current = new ((window as any).AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                }
                const audioContext = speechAudioContextRef.current;
                await audioContext.resume();

                const speechBuffer = await decodePcmAudioData(decode(speechData), audioContext, 24000, 1);
                if (jobId !== audioJobIdRef.current) { setIsReading(false); return; }

                await startMusic();
                if (jobId !== audioJobIdRef.current) {
                    stopMusic();
                    setIsReading(false);
                    return;
                }

                if (musicGainNodeRef.current && musicAudioContextRef.current) {
                    musicGainNodeRef.current.gain.setTargetAtTime(0.2, musicAudioContextRef.current.currentTime, 0.1);
                }

                const speechSource = audioContext.createBufferSource();
                speechSource.buffer = speechBuffer;
                speechSource.connect(audioContext.destination);
                speechSource.onended = () => {
                    if (jobId === audioJobIdRef.current && speechSourceRef.current === speechSource) {
                        stopSpeech();
                    }
                };
                speechSourceRef.current = speechSource;
                speechSource.start();
            } catch (err) {
                console.error(err);
                if (jobId === audioJobIdRef.current) {
                    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                    setError(errorMessage);
                    stopSpeech();
                }
            }
        };

        if (activeItem.speechData) {
            await playAudioFromData(activeItem.speechData);
        } else {
            setIsGeneratingStoryAssets(true);
            setError(null);
            try {
                const [newSpeechData, newStoryImageData] = await Promise.all([
                    generateSpeech(activeItem.storyText),
                    generateStoryImage(activeItem.storyText)
                ]);

                if (jobId !== audioJobIdRef.current) return;
                
                setHistory(prev => {
                    const newHistory = prev.map(item => 
                        item.id === activeHistoryId ? { ...item, speechData: newSpeechData, storyImageDataUrl: newStoryImageData } : item
                    );
                    try {
                        localStorage.setItem('coloringBookHistory', JSON.stringify(newHistory));
                    } catch (e) {
                        console.error("Failed to save history to localStorage", e);
                        setError("Could not save story assets to browser history. Storage might be full.");
                    }
                    return newHistory;
                });
                
                await playAudioFromData(newSpeechData);

            } catch (err) {
                console.error(err);
                if (jobId === audioJobIdRef.current) {
                    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                    setError(errorMessage);
                }
            } finally {
                if (jobId === audioJobIdRef.current) {
                    setIsGeneratingStoryAssets(false);
                }
            }
        }
    }, [history, activeHistoryId, isReading, stopSpeech, startMusic, stopMusic]);
    
    const handleHistoryClick = (id: number) => {
        const item = history.find(h => h.id === id);
        if (item) {
            stopSpeech();
            setIsStoryMode(false);
            setRecognizedText(item.recognizedText);
            setGeneratedImage(item.generatedImage);
            setStoryText(item.storyText);
            setUserDrawingDataUrl(item.userDrawingDataUrl);
            setActiveHistoryId(id);
            setVideoObjectUrl(null);
        }
    };

    const handleClearHistory = () => {
        if (window.confirm("Are you sure you want to clear all your saved creations?")) {
            handleClearDrawing();
            setHistory([]);
            try {
                localStorage.removeItem('coloringBookHistory');
            } catch (e) {
                console.error("Failed to clear history from localStorage", e);
                setError("Could not clear browser history. Storage might be full or permissions are denied.");
            }
        }
    };

    const handleDeleteHistoryItem = (idToDelete: number, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent handleHistoryClick from firing
        if (window.confirm("Are you sure you want to delete this creation?")) {
            if (activeHistoryId === idToDelete) {
                handleClearDrawing();
            }
            setHistory(prev => {
                const newHistory = prev.filter(item => item.id !== idToDelete);
                try {
                    localStorage.setItem('coloringBookHistory', JSON.stringify(newHistory));
                } catch (e) {
                    console.error("Failed to save history to localStorage", e);
                    setError("Could not update browser history. Storage might be full.");
                }
                return newHistory;
            });
        }
    };

    const handleBackToDrawing = () => {
        setIsStoryMode(false);
        stopSpeech();
    };

    const toggleMusic = useCallback(async () => {
        if (isReading) return;
        if (isMusicPlaying) {
            stopMusic();
        } else {
            await startMusic();
        }
    }, [isMusicPlaying, isReading, startMusic, stopMusic]);

    useEffect(() => {
        return () => {
            stopSpeech();
            speechAudioContextRef.current?.close();
            stopMusic();
            musicAudioContextRef.current?.close();
            // Clean up cached object URLs
            videoUrlCache.current.forEach(url => URL.revokeObjectURL(url));
        }
    }, [stopSpeech, stopMusic]);
    
    useEffect(() => {
        const canvas = userCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !canvas) return;

        if (userDrawingDataUrl) {
            const img = new Image();
            img.onload = () => {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = userDrawingDataUrl;
        } else {
             ctx.fillStyle = '#FFFFFF';
             ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }, [userDrawingDataUrl, isStoryMode]);

    useEffect(() => {
        const resizeCanvases = () => {
            const activeHistoryItem = history.find(h => h.id === activeHistoryId);

            [userCanvasRef, aiCanvasRef].forEach(ref => {
                if (ref.current) {
                    const canvas = ref.current;
                    const container = canvas.parentElement;
                    if(container) {
                        const size = container.clientWidth;
                        if (canvas.width !== size || canvas.height !== size) {
                           canvas.width = size;
                           canvas.height = size;
                        }
                    }
                }
            });
            
            if(activeHistoryItem) {
                const userCanvas = userCanvasRef.current;
                const userCtx = userCanvas?.getContext('2d');
                if (userCtx && userCanvas && activeHistoryItem.userDrawingDataUrl) {
                    const img = new Image();
                    img.onload = () => {
                        userCtx.fillStyle = '#FFFFFF';
                        userCtx.fillRect(0, 0, userCanvas.width, userCanvas.height);
                        userCtx.drawImage(img, 0, 0, userCanvas.width, userCanvas.height);
                    };
                    img.src = activeHistoryItem.userDrawingDataUrl;
                }
            } else {
                const userCanvas = userCanvasRef.current;
                 const ctx = userCanvas?.getContext('2d');
                 if (ctx && userCanvas) {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, userCanvas.width, userCanvas.height);
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 5;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                 }
            }
        };

        window.addEventListener('resize', resizeCanvases);
        resizeCanvases();
        return () => window.removeEventListener('resize', resizeCanvases);
    }, [history, activeHistoryId]);

    const storyModeButtons = () => {
        const hasVideo = !!activeItem?.videoApiUri;
        const isProcessing = isReading || isGeneratingStoryAssets || isGeneratingVideo;
        return (
            <div className="flex flex-col sm:flex-row justify-center gap-4 w-full">
                <button onClick={handleBackToDrawing} disabled={isProcessing} className="flex-1 bg-gray-200 text-gray-700 font-medium py-2 px-6 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    Back to Drawing
                </button>
                { !hasVideo && (
                    <button onClick={handleGenerateVideo} disabled={isProcessing} className="flex-1 bg-teal-500 text-white font-medium py-2 px-6 rounded-lg hover:bg-teal-600 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                        { isGeneratingVideo 
                            ? <ButtonSpinner className="w-5 h-5 mr-2" />
                            : <FilmIcon className="w-5 h-5 mr-2" />
                        }
                        { isGeneratingVideo ? 'Making Video...' : 'Generate Video' }
                    </button>
                )}
                 <button onClick={handleReadStory} disabled={isGeneratingStory || isGeneratingStoryAssets || isGeneratingVideo} className="flex-1 bg-green-500 text-white font-medium py-2 px-6 rounded-lg hover:bg-green-600 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                    {isReading 
                        ? <StopIcon className="w-5 h-5 mr-2" /> 
                        : isGeneratingStoryAssets 
                            ? <ButtonSpinner className="w-5 h-5 mr-2" />
                            : <SpeakerWaveIcon className="w-5 h-5 mr-2" />
                    }
                    {isReading ? 'Stop' : isGeneratingStoryAssets ? 'Generating...' : 'Read Story'}
                </button>
            </div>
        );
    }


    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4">
            <main className="bg-white rounded-2xl shadow-xl p-6 md:p-8 w-full max-w-6xl">
                <header className="text-center mb-6 relative">
                    <h1 className="text-4xl md:text-5xl font-bold text-gray-800 font-brand text-blue-600">AI Coloring Book Creator</h1>
                    <p className="text-gray-600 mt-2">Draw, color, and bring your stories to life!</p>
                    <div className="absolute top-0 right-0 p-2">
                        <button 
                            onClick={toggleMusic} 
                            disabled={isMusicLoading || isReading}
                            className="p-2 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label={isMusicPlaying ? "Stop background music" : "Play background music"}
                            title={isMusicPlaying ? "Stop background music" : "Play background music"}
                        >
                            {isMusicPlaying 
                                ? <SpeakerWaveIcon className="w-6 h-6 text-blue-600" /> 
                                : <SpeakerXMarkIcon className="w-6 h-6 text-gray-500" />
                            }
                        </button>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 items-start">
                    <div className="flex flex-col items-center">
                        <h2 className="text-xl font-semibold text-gray-700 mb-3">{isStoryMode ? 'Your Story' : '1. Your Masterpiece'}</h2>
                         <div className="h-8 mb-2 text-center">
                           {recognizedText && <p className="text-lg font-semibold text-blue-600 transition-opacity duration-300">I see... {recognizedText}!</p>}
                        </div>
                        <div className="w-full aspect-square border-2 border-gray-300 rounded-lg shadow-inner overflow-hidden relative">
                            <video 
                                ref={videoRef}
                                src={videoObjectUrl ?? ''}
                                className={`absolute inset-0 w-full h-full object-cover z-20 transition-opacity duration-300 ${videoObjectUrl ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                                loop
                                muted
                                playsInline
                            />
                            <div className={`absolute inset-0 bg-yellow-50 overflow-y-auto p-4 text-gray-800 leading-relaxed transition-opacity duration-300 ${isStoryMode ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
                                {storyText?.split('\n').map((paragraph, index) => <p key={index} className="mb-4">{paragraph}</p>)}
                            </div>
                            
                            <div className={`w-full h-full bg-white ${activeHistoryId ? 'pointer-events-none' : ''}`}>
                                <canvas ref={userCanvasRef} />
                            </div>
                        </div>
                         <div className="mt-4 flex flex-col sm:flex-row justify-center gap-4 w-full min-h-[42px]">
                            {isStoryMode ? (
                                storyModeButtons()
                            ) : (
                                <button onClick={handleClearDrawing} className="w-full md:w-auto bg-gray-200 text-gray-700 font-medium py-2 px-6 rounded-lg hover:bg-gray-300 transition-colors">
                                    Clear Drawing
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col items-center space-y-3 pt-24">
                         <div className="flex items-center gap-2 mb-2">
                            <PaintBrushIcon className="w-6 h-6 text-gray-600" />
                            <h3 className="text-lg font-semibold text-gray-600">Palette</h3>
                        </div>
                        {colors.map((c) => (
                            <button
                                key={c}
                                onClick={() => setSelectedColor(c)}
                                className={`w-10 h-10 rounded-full transition-transform transform hover:scale-110 shadow-md ${selectedColor === c ? 'ring-4 ring-offset-2 ring-blue-500' : 'ring-2 ring-gray-200'}`}
                                style={{ backgroundColor: c, border: c === '#FFFFFF' ? '1px solid #ccc' : 'none' }}
                                aria-label={`Select color ${c}`}
                            />
                        ))}
                    </div>

                    <div className="flex flex-col items-center">
                        <h2 className="text-xl font-semibold text-gray-700 mb-3">2. AI Coloring Page</h2>
                        {history.length > 0 && (
                            <div className="mb-2 w-full">
                                <div className="flex justify-between items-center mb-1">
                                    <h3 className="text-sm font-semibold text-gray-600">History:</h3>
                                    <button onClick={handleClearHistory} className="text-xs text-red-500 hover:underline">Clear History</button>
                                </div>
                                <div className="flex flex-wrap gap-2 p-2 bg-gray-100 rounded-md">
                                    {history.map((item, index) => (
                                        <div key={item.id} className="relative group">
                                            <button 
                                                onClick={() => handleHistoryClick(item.id)}
                                                className={`w-10 h-10 rounded-md flex items-center justify-center font-bold text-gray-700 transition-colors ${activeHistoryId === item.id ? 'bg-blue-500 text-white ring-2 ring-blue-700' : 'bg-white hover:bg-blue-100'}`}
                                            >
                                                {index + 1}
                                                {item.videoApiUri && <FilmIcon className="absolute -top-1 -right-1 w-4 h-4 text-teal-500 bg-white rounded-full p-0.5" />}
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteHistoryItem(item.id, e)}
                                                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                                                aria-label={`Delete creation ${index + 1}`}
                                                title={`Delete creation ${index + 1}`}
                                            >
                                                <XMarkIcon className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className={`relative w-full aspect-square bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg shadow-inner overflow-hidden ${generatedImage ? 'cursor-pointer' : ''}`}>
                             {isStoryMode && userDrawingDataUrl && (
                                <img
                                    src={userDrawingDataUrl}
                                    alt="Your original drawing"
                                    className="absolute top-3 left-3 w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-white shadow-lg object-cover z-20"
                                />
                            )}
                            {isReading && activeItem?.storyImageDataUrl && (
                                <img
                                    src={`data:image/png;base64,${activeItem.storyImageDataUrl}`}
                                    alt="A colorful illustration of the story"
                                    className="absolute inset-0 w-full h-full object-cover z-10 transition-opacity duration-500"
                                />
                            )}
                            <canvas ref={aiCanvasRef} className={`transition-opacity duration-500 ${isReading && activeItem?.storyImageDataUrl ? 'opacity-0' : 'opacity-100'}`} />
                            {(isLoading || isGeneratingStory || isGeneratingVideo || isGeneratingStoryAssets) && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white bg-opacity-75 backdrop-blur-sm text-center p-4 z-30">
                                    <Spinner />
                                    <p className="mt-4 text-gray-600 font-semibold">
                                        {isLoading ? 'Generating Image...' : isGeneratingStory ? 'Writing Story...' : isGeneratingVideo ? 'Generating Video...' : 'Creating Story Experience...'}
                                    </p>
                                    {isGeneratingVideo && <p className="text-sm text-gray-500 mt-2">The AI is dreaming up your animation! This can take a few minutes.</p>}
                                </div>
                            )}
                        </div>
                         <div className="mt-4 flex justify-center items-center gap-4 min-h-[42px]">
                            {generatedImage ? (
                                <>
                                    <button onClick={handleClearColoring} className="bg-gray-200 text-gray-700 font-medium py-2 px-6 rounded-lg hover:bg-gray-300 transition-colors">
                                        Clear Coloring
                                    </button>
                                    {!isStoryMode && (
                                        <button 
                                            onClick={handleGenerateStory} 
                                            disabled={isGeneratingStory || !activeHistoryId}
                                            className="bg-purple-500 text-white font-medium py-2 px-6 rounded-lg hover:bg-purple-600 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <BookOpenIcon className="w-5 h-5 mr-2" />
                                            {isGeneratingStory ? 'Writing...' : 'Tell me a Story!'}
                                        </button>
                                    )}
                                </>
                            ) : (
                                <p className="text-gray-500 text-sm text-center">
                                    The generated line art will appear here.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-8 text-center">
                    <button 
                        onClick={handleGenerate} 
                        disabled={isLoading || isGeneratingStory || isReading || !!activeHistoryId || isGeneratingVideo || isGeneratingStoryAssets}
                        className="w-full md:w-1/2 bg-blue-600 text-white font-bold py-3 px-8 rounded-lg shadow-lg hover:bg-blue-700 transform hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 flex items-center justify-center mx-auto"
                        title={activeHistoryId ? "Clear drawing to create a new one" : ""}
                    >
                        {isLoading ? 'Generating...' : (
                            <>
                                <SparklesIcon className="w-6 h-6 mr-2" />
                                Generate Coloring Page
                            </>
                        )}
                    </button>
                </div>
            </main>
            <footer className="text-center mt-6 text-gray-500">
                <p>Powered by Google Gemini.</p>
            </footer>
            {error && <MessageBox message={error} onClose={() => setError(null)} />}
        </div>
    );
};

export default App;