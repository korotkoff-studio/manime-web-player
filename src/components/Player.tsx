// src/components/Player.tsx
import { useRef, useEffect, useState, FC } from 'react';
import { Anime4KPipeline, ModeA, Original, render } from 'anime4k-webgpu';

interface PlayerProps {
    src: string;
}

const Player: FC<PlayerProps> = ({ src }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [muted, setMuted] = useState<boolean>(true);
    const [useModeA, setUseModeA] = useState<boolean>(true);
    const renderRef = useRef<any>(null);

    // Эффект для инициализации видео и рендеринга
    useEffect(() => {
        if (!navigator.gpu) {
            console.error('WebGPU не поддерживается в вашем браузере.');
            setError('Ваш браузер не поддерживает WebGPU.');
            setLoading(false);
            return;
        } else {
            console.log('WebGPU поддерживается.');
        }

        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas) {
            console.error('Элементы video или canvas не найдены.');
            setError('Не удалось найти элементы video или canvas.');
            setLoading(false);
            return;
        }

        video.setAttribute('crossorigin', 'anonymous');
        video.muted = muted;
        video.src = src;

        const handleCanPlay = () => {
            console.log('Видео может воспроизводиться.');
        };

        const handleError = (e: Event) => {
            console.error('Ошибка видео:', e);
            setError('Не удалось загрузить видео.');
            setLoading(false);
        };

        const handleLoadedMetadata = () => {
            if (video.videoWidth && video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
                console.log('Метаданные видео загружены.');
            } else {
                console.error('Неверные метаданные видео.');
                setError('Неверные метаданные видео.');
                setLoading(false);
            }
        };

        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('error', handleError);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);

        async function initRender() {
            console.log('Инициализация anime4k-webgpu...');
            try {
                renderRef.current = await render({
                    video: video!,
                    canvas: canvas!,
                    pipelineBuilder: (device, inputTexture) => {
                        console.log('Построение пайплайна...');

                        let pipeline: Anime4KPipeline;

                        if (useModeA) {
                            pipeline = new ModeA({
                                device,
                                inputTexture,
                                nativeDimensions: {
                                    width: video!.videoWidth,
                                    height: video!.videoHeight,
                                },
                                targetDimensions: {
                                    width: video!.videoWidth * 2,
                                    height: video!.videoHeight * 2,
                                },
                            });
                            console.log('Используется ModeA.');
                        } else {
                            pipeline = new Original({
                                inputTexture,
                            });
                            console.log('Используется Original.');
                        }

                        console.log('Пайплайн построен.');

                        return [pipeline];
                    },
                });

                console.log('Render успешно инициализирован.');

                await video!.play();

                console.log('Видео воспроизведение начато.');
                setLoading(false);
            } catch (err) {
                console.error('Ошибка при инициализации anime4k-webgpu:', err);
                setError('Не удалось загрузить видео.');
                setLoading(false);
            }
        }

        initRender();

        return () => {
            console.log('Размонтирование компонента: остановка видео и рендеринга.');
            if (video) {
                video.pause();
                video.removeEventListener('canplay', handleCanPlay);
                video.removeEventListener('error', handleError);
                video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            }
            if (renderRef.current && typeof renderRef.current.stop === 'function') {
                renderRef.current.stop();
                console.log('Render остановлен.');
            }
        };
    }, [src, useModeA]); // Зависимость только от src

    // Эффект для обновления состояния mute
    useEffect(() => {
        const video = videoRef.current;
        if (video) {
            video.muted = muted;
            console.log(`Видео ${muted ? 'заглушено' : 'разглушено'}.`);
        }
    }, [muted]);

    const toggleMute = () => {
        setMuted((prevMuted) => !prevMuted);
    };

    const toggleModeA = () => {
        setUseModeA((prevUseModeA) => !prevUseModeA);
    };

    return (
        <div
            ref={containerRef}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                backgroundColor: '#000',
                overflow: 'hidden',
                zIndex: 9999,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            {loading && !error && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: 'rgba(255, 255, 255, 0.8)',
                        padding: '10px 20px',
                        borderRadius: '5px',
                        zIndex: 1,
                    }}
                >
                    Загрузка видео...
                </div>
            )}

            {error && (
                <div
                    style={{
                        position: 'absolute',
                        top: '10px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(255, 0, 0, 0.8)',
                        color: 'white',
                        padding: '10px 20px',
                        borderRadius: '5px',
                        zIndex: 1,
                    }}
                >
                    {error}
                </div>
            )}

            <button
                onClick={toggleMute}
                style={{
                    position: 'absolute',
                    bottom: '60px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '10px 20px',
                    zIndex: 2,
                }}
            >
                {muted ? 'Включить звук' : 'Выключить звук'}
            </button>

            <button
                onClick={toggleModeA}
                style={{
                    position: 'absolute',
                    bottom: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '10px 20px',
                    zIndex: 2,
                }}
            >
                {useModeA ? 'Отключить ModeA' : 'Включить ModeA'}
            </button>

            <video
                ref={videoRef}
                controls
                style={{ display: 'none' }}
            />

            <canvas
                ref={canvasRef}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    border: 'none',
                }}
            />
        </div>
    );
};

export default Player;
