import {
    Anime4KPipeline,
    Original,
    Anime4KPipelineDescriptor,
    ModeA,
    Anime4KPresetPipelineDescriptor,
    ModeB,
    ModeC,
    ModeAA,
    ModeBB,
    ModeCA,
    CNNx2M,
    CNNx2VL,
    CNNM,
    CNNVL,
} from 'anime4k-webgpu';

import { makeSample, SampleInit } from './SampleLayout';

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
}`;

const sampleExternalTextureWGSL = `
@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var tex_out: texture_2d<f32>;
@group(0) @binding(2) var<uniform> enable_comparison: u32;
@group(0) @binding(3) var tex_origin: texture_2d<f32>;
@group(0) @binding(4) var<uniform> splitRatio: f32;

@fragment
fn main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    let color_origin = textureSample(tex_origin, mySampler, fragUV);
    let color_out = textureSample(tex_out, mySampler, fragUV);
    // comparison split render
    if (enable_comparison == 1) {
        if (fragUV.x < splitRatio - 0.001) {
            // left half screen
            return color_origin;
        }
        if (fragUV.x < splitRatio + 0.001) {
            // red split bar
            return vec4f(1.0, 0, 0, 1.0);
        }
    }

    return color_out;
}
`;

type Settings = {
    requestFrame: string;
    effect: string;
    deblurCoef: number;
    denoiseCoef: number;
    denoiseCoef2: number;
    compareOn: boolean;
    splitRatio: number;
};

async function configureWebGPU(canvas: HTMLCanvasElement) {
    const adapter = await navigator.gpu.requestAdapter();

    if (adapter == null) {
        throw new Error('No WebGPU adapter found');
    }

    const device = await adapter.requestDevice();

    const context = canvas.getContext('webgpu') as GPUCanvasContext;
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format: presentationFormat,
        alphaMode: 'premultiplied',
    });

    return { device, context, presentationFormat };
}

const init: SampleInit = async ({
    canvas, pageState, gui, videoURL, stats,
}) => {
    stats?.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom

    const video = document.createElement('video');
    video.loop = true;
    video.autoplay = true;
    video.muted = true;
    video.src = videoURL ?? '';
    video.setAttribute('crossOrigin', 'anonymous');

    await video.play();

    const WIDTH = video.videoWidth;
    const HEIGHT = video.videoHeight;
    const { devicePixelRatio } = window;

    if (!pageState.active) return () => { };

    const { device, context, presentationFormat } = await configureWebGPU(canvas);

    let videoFrameTexture: GPUTexture = device.createTexture({
        size: [WIDTH, HEIGHT, 1],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.RENDER_ATTACHMENT,
    });


    function updateVideoFrameTexture() {
        device.queue.copyExternalImageToTexture(
            { source: video },
            { texture: videoFrameTexture },
            [WIDTH, HEIGHT],
        );
    }

    const compareBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const splitRatioBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const settings: Settings = {
        requestFrame: 'requestVideoFrameCallback',
        effect: 'Original',
        deblurCoef: 2,
        denoiseCoef: 0.2,
        denoiseCoef2: 2,
        compareOn: false,
        splitRatio: 50,
    };


    let customPipeline: Anime4KPipeline;
    function updatePipeline() {
        const pipelineDescriptor: Anime4KPipelineDescriptor = {
            device,
            inputTexture: videoFrameTexture,
        };
        const presetDescriptor: Anime4KPresetPipelineDescriptor = {
            ...pipelineDescriptor,
            nativeDimensions: {
                width: videoFrameTexture.width,
                height: videoFrameTexture.height,
            },
            targetDimensions: {
                width: canvas.width,
                height: canvas.height,
            },
        };
        switch (settings.effect) {
            case 'Original':
                customPipeline = new Original({ inputTexture: videoFrameTexture });
                break;
            case 'Upscale-CNNx2M':
                customPipeline = new CNNx2M(pipelineDescriptor);
                break;
            case 'Upscale-CNNx2L':
                customPipeline = new CNNx2VL(pipelineDescriptor);
                break;
            case 'Restore-CNNM':
                customPipeline = new CNNM(pipelineDescriptor);
                break;
            case 'Restore-CNNL':
                customPipeline = new CNNVL(pipelineDescriptor);
                break;
            case 'Mode A':
                customPipeline = new ModeA(presetDescriptor);
                break;
            case 'Mode B':
                customPipeline = new ModeB(presetDescriptor);
                break;
            case 'Mode C':
                customPipeline = new ModeC(presetDescriptor);
                break;
            case 'Mode A+A':
                customPipeline = new ModeAA(presetDescriptor);
                break;
            case 'Mode B+B':
                customPipeline = new ModeBB(presetDescriptor);
                break;
            case 'Mode C+A':
                customPipeline = new ModeCA(presetDescriptor);
                break;
            default:
                console.log('Invalid selection');
                break;
        }
    }
    updatePipeline();

    function updateCanvasSize() {
        canvas.width = customPipeline.getOutputTexture().width;
        canvas.height = customPipeline.getOutputTexture().height;
        canvas.style.width = `100%`;
        canvas.style.height = `100%`;
    }
    updateCanvasSize();

    if (gui) {
        for (const folder in gui.__folders) {
            gui.removeFolder(gui.__folders[folder]);
        }
        while (gui.__controllers.length > 0) {
            gui.__controllers[0].remove();
        }
    }
    const generalFolder = gui?.addFolder('General');
    // if (!imageURL) {
    //   generalFolder.add(
    //     settings,
    //     'requestFrame',
    //     ['requestAnimationFrame', 'requestVideoFrameCallback'],
    //   )
    //     .name('Request Frame');
    // }
    const effectController = generalFolder?.add(
        settings,
        'effect',
        [
            'Original',
            'Deblur-DoG',
            'Denoise-BilateralMean',
            // Upscale
            'Upscale-CNNx2M',
            'Upscale-CNNx2UL',
            // Restore
            'Restore-CNNM',
            'Restore-CNNL',
            // presets
            'Mode A',
            'Mode B',
            'Mode C',
            'Mode A+A',
            'Mode B+B',
            'Mode C+A',
        ],
    )
        .name('Effect');

    // Video Pause/Resume
    let isVideoPaused = false;
    generalFolder?.add({
        toggleVideo() {
            if (isVideoPaused) {
                video.play();
                isVideoPaused = false;
                console.log('Video resumed');
            } else {
                video.pause();
                isVideoPaused = true;
                console.log('Video paused');
            }
        },
    }, 'toggleVideo').name('Pause/Resume');

    // Adjust video progress
    let isUserInteracting = false;
    const videoProgress = {
        get time() {
            return video.currentTime;
        },
        set time(t) {
            if (isUserInteracting) {
                video.currentTime = t;
            }
        },
    };

    video.addEventListener('timeupdate', () => {
        if (isUserInteracting) {
            videoProgress.time = video.currentTime;
        }
    });

    generalFolder?.add(videoProgress, 'time', 0, video.duration, 0.1)
        .name('Video Progress')
        .listen()
        .onChange(() => {
            isUserInteracting = true;
            video.currentTime = videoProgress.time;
        })
        .onFinishChange(() => {
            isUserInteracting = false;
        });


    generalFolder?.add(settings, 'compareOn')
        .name('Comparison')
        .onChange((value) => {
            device.queue.writeBuffer(compareBuffer, 0, new Uint32Array([value ? 1 : 0]));
            oneFrame();
        });
    generalFolder?.add(settings, 'splitRatio', 0, 100, 0.1)
        .name('Split Line%')
        .onChange((value) => {
            device.queue.writeBuffer(splitRatioBuffer, 0, new Float32Array([value / 100]));
            oneFrame();
        });

    // initial comparsion setting
    if (settings.compareOn) {
        device.queue.writeBuffer(compareBuffer, 0, new Uint32Array([1]));
    } else {
        device.queue.writeBuffer(compareBuffer, 0, new Uint32Array([0]));
    }
    device.queue.writeBuffer(splitRatioBuffer, 0, new Float32Array([settings.splitRatio / 100]));

    // configure final rendering pipeline
    const renderBindGroupLayout = device.createBindGroupLayout({
        label: 'Render Bind Group Layout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {},
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {},
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' as GPUBufferBindingType },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {},
            },
            {
                binding: 4,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' as GPUBufferBindingType },
            },
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

    // bind 0: sampler
    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
    });

    // configure render pipeline
    let renderBindGroup: GPUBindGroup;
    function updateRenderBindGroup() {
        renderBindGroup = device.createBindGroup({
            layout: renderBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: sampler,
                },
                {
                    binding: 1,
                    resource: customPipeline.getOutputTexture().createView(),
                },
                {
                    binding: 2,
                    resource: {
                        buffer: compareBuffer,
                    },
                },
                {
                    binding: 3,
                    resource: videoFrameTexture.createView(),
                },
                {
                    binding: 4,
                    resource: {
                        buffer: splitRatioBuffer,
                    },
                },
            ],
        });
    }

    updateRenderBindGroup();

    effectController?.onChange((value) => {
        // settings.effect = value;
        updatePipeline();
        updateRenderBindGroup();
        updateCanvasSize();
        oneFrame();
    });

    if (gui) {
        for (const folder in gui.__folders) {
            gui.__folders[folder].open();
        }
    }

    function oneFrame() {
        if (!video.paused) {
            return;
        }
        updateVideoFrameTexture();
        // initialize command recorder
        const commandEncoder = device.createCommandEncoder();

        // encode compute pipeline commands
        customPipeline.pass(commandEncoder);

        // dispatch render pipeline
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
    }

    function frame() {
        stats?.begin();
        // fetch a new frame from video element into texture
        if (!video.paused) {
            // fetch a new frame from video element into texture
            updateVideoFrameTexture();
        }

        // updateFPS();

        // initialize command recorder
        const commandEncoder = device.createCommandEncoder();

        // encode compute pipeline commands
        customPipeline.pass(commandEncoder);

        // dispatch render pipeline
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
        stats?.end();

        // if (imageURL) {
        //   return;
        // }

        // if (settings.requestFrame === 'requestVideoFrameCallback') {
        video.requestVideoFrameCallback(frame);
        //   console.log('requestVideoFrameCallback');
        // } else {
        // requestAnimationFrame(frame);
        //   console.log('requestAnimationFrame');
        // }
    }

    // if (settings.requestFrame === 'requestVideoFrameCallback') {
    video.requestVideoFrameCallback(frame);
    // } else {
    // requestAnimationFrame(frame);
    // }

    // if (imageURL) {
    //   frame();
    //   return;
    // }

    const destroy = () => {
        video.pause();
        video.src = '';
        video.load();
        if (gui) {
            for (const folder in gui.__folders) {
                gui.removeFolder(gui.__folders[folder]);
            }
        }
        console.log('previous loop destroyed');
    };

    return destroy;
};

const VideoUploading: () => JSX.Element = () => makeSample({
    name: 'Manime',
    description: '',
    gui: true,
    init,
    filename: __filename,
});

export default VideoUploading;

