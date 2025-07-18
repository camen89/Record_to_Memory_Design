const FF = 0x0C;
const NAK = 0x15;
const CAN = 0x18;
const ESC = 0x1B;
const GS = 0x1D;
const US = 0x1F;

// canvas画像 → 誤差拡散2値化結果取得
function getErrorDiffusionImage(cvs) {
    const ctx = cvs.getContext('2d');
    const inputData = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
    const output = ctx.createImageData(cvs.width, cvs.height);
    const outputData = output.data;

    const grayArray = toGrayscale(inputData, cvs.width, cvs.height);
    const binaryArray = errorDiffusion1CH(grayArray, cvs.width, cvs.height);

    for (let y = 0; y < cvs.height; y++) {
        for (let x = 0; x < cvs.width; x++) {
            const value = binaryArray[y * cvs.width + x];
            const index = (y * cvs.width + x) * 4;
            outputData[index + 0] = value;
            outputData[index + 1] = value;
            outputData[index + 2] = value;
            outputData[index + 3] = 0xFF;
        }
    }
    return outputData;
}

// ラスターイメージ生成
function getPrintImage(cvs, start_y) {
    const inputData = getErrorDiffusionImage(cvs);
    if (start_y > cvs.height) return null;

    let height = (start_y + 255 < cvs.height) ? start_y + 255 : cvs.height;
    let outputArray = new Uint8Array(cvs.width * (height - start_y) / 8);
    let bytes = 0;
    for (let y = start_y; y < height; y++) {
        for (let x = 0; x < cvs.width; x += 8) {
            let bit8 = 0;
            for (let i = 0; i < 8; i++) {
                let r = inputData[((x + i) + y * cvs.width) * 4];
                bit8 |= (r & 0x01) << (7 - i);
            }
            outputArray[bytes++] = ~bit8;
        }
    }
    return outputArray;
}

// ポート管理用グローバル変数
let m02sPort = null;
let m02sWriter = null;
let m02sReader = null;

async function openPort() {
    if (!m02sPort) {
        m02sPort = await navigator.serial.requestPort();
        await m02sPort.open({ baudRate: 115200 });
        m02sWriter = m02sPort.writable.getWriter();
        m02sReader = m02sPort.readable.getReader();
    }
}

async function closePort() {
    if (m02sWriter) {
        m02sWriter.releaseLock();
        m02sWriter = null;
    }
    if (m02sReader) {
        m02sReader.releaseLock();
        m02sReader = null;
    }
    if (m02sPort) {
        await m02sPort.close();
        m02sPort = null;
    }
}

// 印刷処理本体
async function print() {
    const cvs = document.querySelector('canvas');
    try {
        await openPort();

        await m02sWriter.write(new Uint8Array([ESC, 0x40, 0x02]));
        await m02sWriter.write(new Uint8Array([ESC, 0x40]));
        await m02sWriter.write(new Uint8Array([ESC, 0x61, 0x01]));
        await m02sWriter.write(new Uint8Array([US, 0x11, 0x37, 0x96]));
        await m02sWriter.write(new Uint8Array([US, 0x11, 0x02, 0x01]));

        let start_y = 0;
        while (true) {
            let bit_image = getPrintImage(cvs, start_y);
            if (!bit_image) break;

            let width = cvs.width / 8;
            await m02sWriter.write(new Uint8Array([GS, 0x76, 0x30, 0x00]));
            await m02sWriter.write(new Uint8Array([width & 0xFF, (width >> 8) & 0xFF]));
            let height = bit_image.length / width;
            await m02sWriter.write(new Uint8Array([height & 0xFF, (height >> 8) & 0xFF]));
            await m02sWriter.write(bit_image);

            start_y += (height + 1);
        }

        await m02sWriter.write(new Uint8Array([ESC, 0x64, 0x03]));

        await m02sWriter.write(new Uint8Array([US, 0x11, 0x0E]));
        while (true) {
            const { value, done } = await m02sReader.read();
            if (done) break;
            if (value[2] === 0) break;
        }

        await m02sWriter.write(new Uint8Array([ESC, 0x40, 0x02]));

        alert("印刷が完了しました！");
    } catch (error) {
        alert("Error: " + error);
    } finally {
        await closePort();
    }
}


////////////////// 外部呼び出し用ラッパー
function printFromCanvas(cvs) {
    // 既存の印刷関数を使う
    try {
        const originalCanvas = document.getElementById('resultCanvas');
        // 印刷関数は "canvas" というセレクタで探していることがあるので一時的に差し替え
        const backup = originalCanvas.cloneNode(true);
        originalCanvas.parentNode.replaceChild(cvs, originalCanvas);
        cvs.id = 'resultCanvas'; // ID付与

        print(); // 既存関数呼び出し

        // 元に戻す
        cvs.parentNode.replaceChild(backup, cvs);

    } catch (e) {
        console.error('印刷エラー:', e);
    }
}