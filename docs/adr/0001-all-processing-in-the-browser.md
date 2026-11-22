# All audio processing runs inside the browser

The app is a web page, and every processing step (Separation, Noise Reduction, mixing, export) runs in the browser itself (WebAssembly / WebGPU), with model weights stored alongside the app. No local server and no third-party service.

The obvious alternative was a local Python server (PyTorch Demucs, DeepFilterNet) with a browser front end. That would give better speed and more model choices, but the development machine has no Python, ffmpeg or discrete GPU (i5-1235U, Iris Xe, 16 GB RAM), and the user asked for a browser app with nothing to install. In-browser Separation of a 3–4 minute song is expected to take several minutes on this CPU. For a single user working on one Recording at a time, that trade-off is acceptable.

Revisit this if Separation proves too slow or memory-hungry in the browser. The fallback is a Windows desktop build backed by native/Python inference.
