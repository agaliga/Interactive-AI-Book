// FIX: Import GenerateVideosResponse for type safety with the Operation generic type.
import { GoogleGenAI, Modality, Operation, GenerateVideosResponse } from "@google/genai";

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Recognizes the content of an image using Gemini.
 * @param base64ImageData The base64 encoded image data.
 * @returns A string describing the image content.
 */
export async function recognizeImage(base64ImageData: string): Promise<string> {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    { text: "Identify the main subject of this child's drawing in 5 words or less (e.g., 'a simple truck', 'a smiling cat'). Be very concise and descriptive." },
                    { inlineData: { mimeType: 'image/png', data: base64ImageData } }
                ]
            }
        });

        const text = response.text;
        if (!text) {
            throw new Error("API returned no text for image recognition.");
        }
        return text.trim();
    } catch (error) {
        console.error("Error in recognizeImage:", error);
        throw new Error("Failed to recognize the drawing. The AI might be busy. Please try again.");
    }
}

/**
 * Generates a coloring book page from a text prompt using Imagen.
 * @param promptText The text prompt to generate the image from.
 * @returns A base64 encoded string of the generated PNG image.
 */
export async function generateColoringPageImage(promptText: string): Promise<string> {
    try {
        const fullPrompt = `A very simple black and white coloring book page of: '${promptText}'. The lines must be thick, bold, and clear, suitable for a 4-year-old kid to color. No shading, just clean, simple line art on a pure white background.`;
        
        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: fullPrompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/png',
                aspectRatio: '1:1',
            },
        });

        const image = response.generatedImages[0]?.image?.imageBytes;

        if (!image) {
            throw new Error("API returned no image data.");
        }
        return image;
    } catch (error) {
        console.error("Error in generateColoringPageImage:", error);
        throw new Error("Failed to generate the coloring page. The AI might be busy. Please try again.");
    }
}

/**
 * Generates a short, kid-friendly story from a text prompt.
 * @param promptText The text prompt to generate the story from.
 * @returns A string containing the story.
 */
export async function generateStory(promptText: string): Promise<string> {
    try {
        const fullPrompt = `Write a very short, simple, and happy story for a 4-year-old child about: '${promptText}`;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: fullPrompt,
        });

        const story = response.text;
        if (!story) {
            throw new Error("API returned no text for the story.");
        }
        return story.trim();
    } catch (error) {
        console.error("Error in generateStory:", error);
        throw new Error("Failed to generate the story. The AI might be busy. Please try again.");
    }
}

/**
 * Generates speech from text.
 * @param text The text to convert to speech.
 * @returns A base64 encoded string of the audio data.
 */
export async function generateSpeech(text: string): Promise<string> {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: `Read this story in a gentle, friendly voice: ${text}` }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });

        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) {
            throw new Error("API returned no audio data for the speech.");
        }
        return audioData;
    } catch (error) {
        console.error("Error in generateSpeech:", error);
        throw new Error("Failed to generate speech. The AI might be busy. Please try again.");
    }
}

/**
 * Generates a colorful story image from a text prompt.
 * @param promptText The story text to generate the image from.
 * @returns A base64 encoded string of the generated PNG image.
 */
export async function generateStoryImage(promptText: string): Promise<string> {
    try {
        const fullPrompt = `A vibrant, colorful, and cheerful illustration for a children's story about: '${promptText}'. The style should be whimsical and friendly, like a page from a modern digital storybook, full of bright colors and soft details.`;

        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: fullPrompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/png',
                aspectRatio: '1:1',
            },
        });

        const image = response.generatedImages[0]?.image?.imageBytes;

        if (!image) {
            throw new Error("API returned no image data for the story illustration.");
        }
        return image;
    } catch (error) {
        console.error("Error in generateStoryImage:", error);
        throw new Error("Failed to generate the story illustration. The AI might be busy. Please try again.");
    }
}


/**
 * Starts the video generation process.
 * @param promptText The text prompt to generate the video from.
 * @returns A promise that resolves to the initial operation object.
 */
// FIX: The Operation type is generic and requires a type argument.
export async function startVideoGeneration(promptText: string): Promise<Operation<GenerateVideosResponse>> {
    try {
        // Re-create ai instance to get latest key from the dialog.
        const aiWithKey = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const fullPrompt = `Create a short, cute, and happy animated video for a 4-year-old child about: '${promptText}'. The style should be like a cartoon or a children's book illustration.`;

        const operation = await aiWithKey.models.generateVideos({
            model: 'veo-3.1-fast-generate-preview',
            prompt: fullPrompt,
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: '9:16' // Portrait aspect ratio
            }
        });
        return operation;
    } catch (error) {
        console.error("Error in startVideoGeneration:", error);
        throw error; // Rethrow to be handled by the component
    }
}

/**
 * Checks the status of a video generation operation.
 * @param operation The operation object to check.
 * @returns A promise that resolves to the updated operation object.
 */
// FIX: The Operation type is generic and requires a type argument for both the parameter and return type.
export async function checkVideoOperationStatus(operation: Operation<GenerateVideosResponse>): Promise<Operation<GenerateVideosResponse>> {
    try {
        // Re-create ai instance to get latest key from the dialog.
        const aiWithKey = new GoogleGenAI({ apiKey: process.env.API_KEY });
        return await aiWithKey.operations.getVideosOperation({ operation: operation });
    } catch (error) {
        console.error("Error in checkVideoOperationStatus:", error);
        throw error; // Rethrow to be handled by the component
    }
}