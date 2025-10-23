
import { useEffect, useRef, useCallback, RefObject } from 'react';

export const useDrawingCanvas = (canvasRef: RefObject<HTMLCanvasElement>) => {
    const isDrawing = useRef(false);
    const lastPosition = useRef<{ x: number; y: number } | null>(null);

    const getCoordinates = (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e instanceof MouseEvent) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            return null;
        }

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const startDrawing = useCallback((e: MouseEvent | TouchEvent) => {
        e.preventDefault();
        const coords = getCoordinates(e);
        if (!coords) return;
        isDrawing.current = true;
        lastPosition.current = coords;
    }, [canvasRef]);

    const draw = useCallback((e: MouseEvent | TouchEvent) => {
        e.preventDefault();
        if (!isDrawing.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        const coords = getCoordinates(e);

        if (!ctx || !coords || !lastPosition.current) return;
        
        ctx.beginPath();
        ctx.moveTo(lastPosition.current.x, lastPosition.current.y);
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();

        lastPosition.current = coords;
    }, [canvasRef]);

    const stopDrawing = useCallback(() => {
        isDrawing.current = false;
        lastPosition.current = null;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        ctx?.beginPath();
    }, [canvasRef]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Initial setup
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5; // Bolder line for better AI detection
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Event Listeners
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);

        canvas.addEventListener('touchstart', startDrawing);
        canvas.addEventListener('touchmove', draw);
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);

        return () => {
            canvas.removeEventListener('mousedown', startDrawing);
            canvas.removeEventListener('mousemove', draw);
            canvas.removeEventListener('mouseup', stopDrawing);
            canvas.removeEventListener('mouseout', stopDrawing);

            canvas.removeEventListener('touchstart', startDrawing);
            canvas.removeEventListener('touchmove', draw);
            canvas.removeEventListener('touchend', stopDrawing);
            canvas.removeEventListener('touchcancel', stopDrawing);
        };
    }, [canvasRef, startDrawing, draw, stopDrawing]);

    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx && canvas) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }, [canvasRef]);

    const isCanvasBlank = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return true;
        const ctx = canvas.getContext('2d');
        if(!ctx) return true;

        const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
        const whitePixel = 0xFFFFFFFF; // White in RGBA (little-endian)
        return !pixelBuffer.some(pixel => pixel !== whitePixel);
    }, [canvasRef]);

    return { clearCanvas, isCanvasBlank };
};
