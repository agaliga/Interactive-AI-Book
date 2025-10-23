
import { useEffect, useCallback, RefObject } from 'react';

const hexToRgba = (hex: string): [number, number, number, number] => {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) { // #RGB
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) { // #RRGGBB
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }
    return [r, g, b, 255];
};

export const useColoringCanvas = (
    canvasRef: RefObject<HTMLCanvasElement>,
    base64Image: string | null,
    color: string,
    coloredImageDataUrl: string | undefined,
    onColor: () => void
) => {
    
    const drawImage = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (!base64Image) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = coloredImageDataUrl || `data:image/png;base64,${base64Image}`;
    }, [base64Image, canvasRef, coloredImageDataUrl]);

    useEffect(() => {
        drawImage();
    }, [drawImage]);
    
    const floodFill = (ctx: CanvasRenderingContext2D, startX: number, startY: number, fillColorRgba: [number, number, number, number]) => {
        const canvas = ctx.canvas;
        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        const startIdx = (startY * width + startX) * 4;
        const startColor = [data[startIdx], data[startIdx+1], data[startIdx+2]];

        // If the starting point is already the fill color, do nothing.
        if (startColor[0] === fillColorRgba[0] && startColor[1] === fillColorRgba[1] && startColor[2] === fillColorRgba[2]) {
            return;
        }
        
        // A threshold to identify line pixels (anti-aliased edges are gray)
        const lineThreshold = 128;
        if (startColor[0] < lineThreshold && startColor[1] < lineThreshold && startColor[2] < lineThreshold) {
            return; // Don't fill if a line is clicked
        }

        const queue: [number, number][] = [[startX, startY]];
        
        while (queue.length > 0) {
            const [x, y] = queue.shift()!;
            
            if (x < 0 || x >= width || y < 0 || y >= height) {
                continue;
            }
            
            const currentIdx = (y * width + x) * 4;
            const r = data[currentIdx];
            const g = data[currentIdx + 1];
            const b = data[currentIdx + 2];
            
            // If the pixel is a line, treat it as a boundary.
            if (r < lineThreshold && g < lineThreshold && b < lineThreshold) {
                continue;
            }

            // If the pixel is not the same color as the area we started filling, it's a boundary.
            const tolerance = 32;
            const isSameArea = Math.abs(r - startColor[0]) < tolerance && Math.abs(g - startColor[1]) < tolerance && Math.abs(b - startColor[2]) < tolerance;
            if (!isSameArea) {
                continue;
            }

            // If it's already the color we want to fill, skip it.
            if (r === fillColorRgba[0] && g === fillColorRgba[1] && b === fillColorRgba[2]) {
                continue;
            }
            
            // Color the pixel.
            data[currentIdx] = fillColorRgba[0];
            data[currentIdx + 1] = fillColorRgba[1];
            data[currentIdx + 2] = fillColorRgba[2];
            data[currentIdx + 3] = fillColorRgba[3];
            
            // Add neighbors to the queue.
            queue.push([x + 1, y]);
            queue.push([x - 1, y]);
            queue.push([x, y + 1]);
            queue.push([x, y - 1]);
        }
        
        ctx.putImageData(imageData, 0, 0);
    };


    const handleCanvasClick = useCallback((e: MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.floor((e.clientX - rect.left) * scaleX);
        const y = Math.floor((e.clientY - rect.top) * scaleY);
        
        const fillColorRgba = hexToRgba(color);
        floodFill(ctx, x, y, fillColorRgba);
        onColor();

    }, [canvasRef, color, onColor]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !base64Image) return;

        canvas.addEventListener('click', handleCanvasClick);
        return () => {
            canvas.removeEventListener('click', handleCanvasClick);
        };
    }, [canvasRef, base64Image, handleCanvasClick]);

    const clearColoring = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !base64Image) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = `data:image/png;base64,${base64Image}`;
    }, [base64Image, canvasRef]);

    return { clearColoring };
};
