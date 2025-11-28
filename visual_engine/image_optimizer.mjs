import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';

/**
 * Optimizes an image for AI processing by:
 * - Tiered resizing based on image size
 * - Converting to JPEG with quality compression
 * - Reducing file size while maintaining readability
 * 
 * @param {string} inputPath - Path to the input image.
 * @param {Object} options - Optimization options
 * @param {number} options.quality - JPEG quality 0-100 (default: 45)
 * @returns {Promise<string>} - Path to the optimized image.
 */
export async function optimizeImage(inputPath, options = {}) {
    const quality = options.quality || 45;

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

        // 🎯 TIERED OPTIMIZATION: הפחתה מדורגת לפי גודל
        let pipeline = sharp(inputPath);
        const LARGE_THRESHOLD = 1800;  // מסך מלא
        const MEDIUM_THRESHOLD = 800;   // פוסט בינוני

        if (originalWidth > LARGE_THRESHOLD) {
            // תמונה גדולה (מסך מלא) - הקטן ב-40%
            const newWidth = Math.round(originalWidth * 0.6);  // 40% הפחתה = 60% נותר
            const newHeight = Math.round(originalHeight * 0.6);
            pipeline = pipeline.resize(newWidth, newHeight, {
                withoutEnlargement: true,
                fit: 'inside'
            });
            console.log(`   🖥️ מסך מלא - הקטנה 40%: ${originalWidth}x${originalHeight} → ${newWidth}x${newHeight}`);
        } else if (originalWidth > MEDIUM_THRESHOLD) {
            // תמונה בינונית (פוסט רגיל) - הקטן ב-30%
            const newWidth = Math.round(originalWidth * 0.7);  // 30% הפחתה = 70% נותר
            const newHeight = Math.round(originalHeight * 0.7);
            pipeline = pipeline.resize(newWidth, newHeight, {
                withoutEnlargement: true,
                fit: 'inside'
            });
            console.log(`   📱 פוסט בינוני - הקטנה 30%: ${originalWidth}x${originalHeight} → ${newWidth}x${newHeight}`);
        } else {
            // תמונה קטנה - שמור על גודל מקורי
            console.log(`   📷 תמונה קטנה - שומר על גודל מקורי: ${originalWidth}x${originalHeight}`);
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
