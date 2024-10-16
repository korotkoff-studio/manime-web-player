import React, { useRef, useEffect } from 'react';
import { CNNM, CNNUL, CNNx2M, CNNx2UL } from 'anime4k-webgpu';

const fullscreenTexturedQuadWGSL = `
struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) fragUV : vec2<f32>,
}

@vertex
fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
  const pos = array(
    vec2( 1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2(-1.0,  1.0),
  );

  const uv = array(
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(0.0, 0.0),
  );

  var output : VertexOutput;
  output.Position = vec4(pos[VertexIndex], 0.0, 1.0);
  output.fragUV = uv[VertexIndex];
  return output;
}
`;

const sampleExternalTextureWGSL = `
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

@fragment
fn main(@location(0) fragUV : vec2f) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(myTexture, mySampler, fragUV);
}
`;

// Определяем интерфейс для пропсов компонента Player
interface PlayerProps {
    src: string;
}

const Player: React.FC<PlayerProps> = ({ src }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        async function init() {
            // Создание элемента видео
            const video = videoRef.current!;

            video.loop = true;
            video.autoplay = true;
            video.muted = true;
            video.src = src;
            video.setAttribute('crossorigin', 'anonymous');

            await new Promise((resolve) => {
                video.onloadeddata = resolve;
            });
            await video.play();
            const WIDTH = video.videoWidth;
            const HEIGHT = video.videoHeight;

            // Настройка WebGPU
            const canvas = canvasRef.current!;
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.error('WebGPU не поддерживается на этом устройстве.');
                return;
            }
            const device = await adapter.requestDevice();
            const context = canvas.getContext('webgpu') as GPUCanvasContext;
            const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
            context.configure({
                device,
                format: presentationFormat,
                alphaMode: 'premultiplied',
            });

            // Создание текстуры видео
            const videoFrameTexture = device.createTexture({
                size: [WIDTH, HEIGHT, 1],
                format: 'rgba16float',
                usage: GPUTextureUsage.TEXTURE_BINDING
                    | GPUTextureUsage.COPY_DST
                    | GPUTextureUsage.RENDER_ATTACHMENT,
            });

            // ++++ Anime4K ++++
            const upscalePipeline = new CNNx2M({
                device,
                inputTexture: videoFrameTexture,
            });
            const restorePipeline = new CNNM({
                device,
                inputTexture: upscalePipeline.getOutputTexture(),
            });
            // Опционально: изменение размера канваса под размер выходной текстуры
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            // ++++ Anime4K ++++

            // Функция для копирования нового кадра видео в текстуру
            function updateVideoFrameTexture() {
                device.queue.copyExternalImageToTexture(
                    { source: video },
                    { texture: videoFrameTexture },
                    [WIDTH, HEIGHT],
                );
            }

            // Настройка пайплайна рендеринга
            const renderBindGroupLayout = device.createBindGroupLayout({
                label: 'Render Bind Group Layout',
                entries: [
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        sampler: {},
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {},
                    }
                ],
            });

            const renderPipelineLayout = device.createPipelineLayout({
                label: 'Render Pipeline Layout',
                bindGroupLayouts: [renderBindGroupLayout],
            });

            const renderPipeline = device.createRenderPipeline({
                layout: renderPipelineLayout,
                vertex: {
                    module: device.createShaderModule({
                        code: fullscreenTexturedQuadWGSL,
                    }),
                    entryPoint: 'vert_main',
                },
                fragment: {
                    module: device.createShaderModule({
                        code: sampleExternalTextureWGSL,
                    }),
                    entryPoint: 'main',
                    targets: [
                        {
                            format: presentationFormat,
                        },
                    ],
                },
                primitive: {
                    topology: 'triangle-list',
                },
            });

            const sampler = device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            const renderBindGroup = device.createBindGroup({
                layout: renderBindGroupLayout,
                entries: [
                    {
                        binding: 1,
                        resource: sampler,
                    },
                    {
                        binding: 2,
                        // +++ Anime4K +++
                        resource: restorePipeline.getOutputTexture().createView(),
                        // +++ Anime4K +++
                    }
                ],
            });

            // Цикл рендеринга
            function frame() {
                if (!video.paused) {
                    updateVideoFrameTexture();
                }
                const commandEncoder = device.createCommandEncoder();
                // +++ Anime4K +++
                upscalePipeline.pass(commandEncoder);
                restorePipeline.pass(commandEncoder);
                // +++ Anime4K +++
                const passEncoder = commandEncoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: context.getCurrentTexture().createView(),
                            clearValue: {
                                r: 0.0, g: 0.0, b: 0.0, a: 1.0,
                            },
                            loadOp: 'clear' as GPULoadOp,
                            storeOp: 'store' as GPUStoreOp,
                        },
                    ],
                });
                passEncoder.setPipeline(renderPipeline);
                passEncoder.setBindGroup(0, renderBindGroup);
                passEncoder.draw(6);
                passEncoder.end();
                device.queue.submit([commandEncoder.finish()]);
                video.requestVideoFrameCallback(frame);
            }

            // Запуск цикла рендеринга
            video.requestVideoFrameCallback(frame);
        }

        // Проверка поддержки WebGPU
        if (navigator.gpu) {
            init().catch((err) => {
                console.error('Ошибка инициализации WebGPU:', err);
            });
        } else {
            console.error('WebGPU не поддерживается вашим браузером.');
        }
    }, [src]);

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100vw', height: '100vh', overflow: 'hidden' }}>
            <video ref={videoRef} controls style={{ display: 'none' }} />
            <canvas
                ref={canvasRef}
                style={{ maxWidth: '100%', maxHeight: '100%' }}
            />
        </div>
    );
};

export default Player;
