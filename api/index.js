const { createCanvas, loadImage } = require('@napi-rs/canvas');
const GIFEncoder = require('gifencoder');
const gifFrames = require('gif-frames');

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

        // Kart ve çerçeveyi (varsa) eşzamanlı indiriyoruz
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
            // === GIF İŞLEME AŞAMASI ===
            const encoder = new GIFEncoder(width, height);
            encoder.start();
            encoder.setRepeat(0); // Sonsuz döngü
            encoder.setDelay(100); // Kareler arası ms hızı (100ms = 10fps)
            encoder.setQuality(10); // Görüntü kalitesi (1 en iyi, 10 varsayılan)

            // GIF'in tüm karelerini ayıklıyoruz
            const framesData = await gifFrames({ url: effect_url, frames: 'all', outputType: 'png', cumulative: true });

            for (let i = 0; i < framesData.length; i++) {
                const stream = framesData[i].getImage();
                
                // Buffer akışını topluyoruz
                const chunkBuffer = await new Promise((resolve, reject) => {
                    const chunks = [];
                    stream.on('data', chunk => chunks.push(chunk));
                    stream.on('end', () => resolve(Buffer.concat(chunks)));
                    stream.on('error', reject);
                });

                const effectImg = await loadImage(chunkBuffer);

                // Tuvali temizle ve sırayla katmanları çiz
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(cardImage, 0, 0, width, height);

                ctx.globalCompositeOperation = 'screen';
                ctx.drawImage(effectImg, 0, 0, width, height);
                ctx.globalCompositeOperation = 'source-over';

                if (frameImage) {
                    ctx.drawImage(frameImage, 0, 0, width, height);
                }

                // Çizilen bu kareyi GIF motoruna ekle
                encoder.addFrame(ctx);
            }

            encoder.finish();
            const buffer = encoder.out.getData();

            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(buffer);

        } else {
            // === STANDART PNG İŞLEME AŞAMASI ===
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
