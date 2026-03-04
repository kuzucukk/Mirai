const { createCanvas, loadImage, ImageData } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const { parseGIF, decompressFrames } = require('gifuct-js');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Sadece POST istekleri kabul edilir.' });
    }

    const { card_url, frame_url, effect_url } = req.body;

    if (!card_url) {
        return res.status(400).json({ error: 'card_url parametresi eksik.' });
    }

    try {
        const isGif = effect_url && effect_url.toLowerCase().endsWith('.gif');

        // Kart ve çerçeveyi indiriyoruz
        const [cardImage, frameImage] = await Promise.all([
            loadImage(card_url).catch(() => null),
            frame_url ? loadImage(frame_url).catch(() => null) : Promise.resolve(null)
        ]);

        if (!cardImage) {
            return res.status(404).json({ error: 'Orijinal kart görseli indirilemedi.' });
        }

        const width = cardImage.width;
        const height = cardImage.height;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        if (isGif) {
            // === SAF JAVASCRIPT İLE ÇÖKMEYEN GIF İŞLEME ===
            const effectResp = await fetch(effect_url);
            if (!effectResp.ok) throw new Error("Efekt GIF'i indirilemedi.");
            const effectBuffer = await effectResp.arrayBuffer();
            
            // GIF'i parse et (gifuct-js)
            const gif = parseGIF(effectBuffer);
            const frames = decompressFrames(gif, true);

            const encoder = new GIFEncoder(width, height);
            encoder.start();
            encoder.setRepeat(0); 
            encoder.setDelay(100); // Kareler arası hız
            encoder.setQuality(10);

            // GIF'in orijinal boyutlarında geçici bir tuval (Çözünürlük ve hizalama için)
            const gifWidth = gif.lsd.width;
            const gifHeight = gif.lsd.height;
            const effectCanvas = createCanvas(gifWidth, gifHeight);
            const effectCtx = effectCanvas.getContext('2d');

            for (let i = 0; i < frames.length; i++) {
                const frame = frames[i];
                
                // Bir önceki karenin temizlenme kuralı (Disposal Method)
                if (i > 0 && frames[i - 1].disposalType === 2) {
                    const prev = frames[i - 1];
                    effectCtx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
                }

                // Sadece değişen pikselleri (patch) çiz
                if (frame.dims.width > 0 && frame.dims.height > 0) {
                    const patchCanvas = createCanvas(frame.dims.width, frame.dims.height);
                    const patchCtx = patchCanvas.getContext('2d');
                    
                    const imageData = new ImageData(
                        new Uint8ClampedArray(frame.patch),
                        frame.dims.width,
                        frame.dims.height
                    );
                    patchCtx.putImageData(imageData, 0, 0);
                    effectCtx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
                }

                // Ana karta geçiyoruz: Önce kartı çiz
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(cardImage, 0, 0, width, height);

                // GIF'i kartın boyutuna otomatik ölçekleyerek Screen (Parlamak) efektiyle yansıt
                ctx.globalCompositeOperation = 'screen';
                ctx.drawImage(effectCanvas, 0, 0, width, height);
                ctx.globalCompositeOperation = 'source-over';

                // En üste PNG çerçeveyi giydir
                if (frameImage) {
                    ctx.drawImage(frameImage, 0, 0, width, height);
                }

                // Oluşturulan bu kareyi GIF motoruna ekle
                encoder.addFrame(ctx);
            }

            encoder.finish();
            const buffer = encoder.out.getData();

            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(buffer);

        } else {
            // === STANDART HAREKETSİZ (PNG/JPG) İŞLEME ===
            const effectImage = effect_url ? await loadImage(effect_url).catch(() => null) : null;

            ctx.drawImage(cardImage, 0, 0, width, height);

            if (effectImage) {
                ctx.globalCompositeOperation = 'screen';
                ctx.drawImage(effectImage, 0, 0, width, height);
                ctx.globalCompositeOperation = 'source-over';
            }

            if (frameImage) {
                ctx.drawImage(frameImage, 0, 0, width, height);
            }

            const buffer = await canvas.encode('png');
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(buffer);
        }

    } catch (error) {
        return res.status(500).json({ error: 'Sunucu içi işlem hatası: ' + error.message });
    }
}
