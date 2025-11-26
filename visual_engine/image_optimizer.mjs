import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';

/**
 * Optimizes an image for AI processing by:
 * - Resizing to a maximum width while maintaining aspect ratio
 * - Converting to JPEG with quality compression
 * - Reducing file size while maintaining readability
 * 
 * @param {string} inputPath - Path to the input image.
 * @param {Object} options - Optimization options
 * @param {number} options.maxWidth - Maximum width in pixels (default: 800)
 * @param {number} options.quality - JPEG quality 0-100 (default: 60)
 * @returns {Promise<string>} - Path to the optimized image.
 */
export async function optimizeImage(inputPath, options = {}) {
    const maxWidth = options.maxWidth || 800;  // Reduced from 1200 to 800
    const quality = options.quality || 60;      // Reduced from 75 to 60

    try {
        console.log(`📉 מתחיל אופטימיזציה של תמונה: ${inputPath}`);

        // Get image metadata
        const metadata = await sharp(inputPath).metadata();
        const originalWidth = metadata.width;
        const originalHeight = metadata.height;
        console.log(`   מידות מקוריות: ${originalWidth}x${originalHeight}`);

        // Create output path (replace extension with .jpg)
        const parsedPath = path.parse(inputPath);
        const outputPath = path.join(parsedPath.dir, `${parsedPath.name}_optimized.jpg`);

        // Resize and compress
        let pipeline = sharp(inputPath);

        if (originalWidth > maxWidth) {
            pipeline = pipeline.resize(maxWidth, null, {
                withoutEnlargement: true,
                fit: 'inside'
            });
            const newHeight = Math.round((originalHeight / originalWidth) * maxWidth);
            console.log(`   שינוי גודל ל: ${maxWidth}x${newHeight}`);
        }

        await pipeline
            .jpeg({ quality, mozjpeg: true })
            .toFile(outputPath);

        // Get file sizes
        const originalStats = await fs.stat(inputPath);
        const optimizedStats = await fs.stat(outputPath);

        const originalSizeMB = (originalStats.size / (1024 * 1024)).toFixed(2);
        const optimizedSizeMB = (optimizedStats.size / (1024 * 1024)).toFixed(2);
        const reduction = ((1 - optimizedStats.size / originalStats.size) * 100).toFixed(1);

        console.log(`📊 תוצאות אופטימיזציה:`);
        console.log(`   גודל מקורי: ${originalSizeMB} MB`);
        console.log(`   גודל מופחת: ${optimizedSizeMB} MB`);
        console.log(`   חיסכון: ${reduction}%`);
        console.log(`✅ תמונה מאופטמת נשמרה ב: ${outputPath}`);

        return outputPath;

    } catch (error) {
        console.error('❌ שגיאה באופטימיזציה:', error);
        console.warn('⚠️ משתמש בתמונה המקורית');
        return inputPath; // Return original on error
    }
}
