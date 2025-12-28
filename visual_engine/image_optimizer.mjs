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
        console.log(`📉 Starting image optimization: ${inputPath}`);

        // Get image metadata
        const metadata = await sharp(inputPath).metadata();
        const originalWidth = metadata.width;
        const originalHeight = metadata.height;
        console.log(`   Original dimensions: ${originalWidth}x${originalHeight}`);

        // Create output path (replace extension with .jpg)
        const parsedPath = path.parse(inputPath);
        const outputPath = path.join(parsedPath.dir, `${parsedPath.name}_optimized.jpg`);

        // 🎯 TIERED OPTIMIZATION: Gradual reduction based on size
        let pipeline = sharp(inputPath);
        const LARGE_THRESHOLD = 1800;  // Full screen
        const MEDIUM_THRESHOLD = 800;   // Regular post

        if (originalWidth > LARGE_THRESHOLD) {
            // Large image (full screen) - reduce by 40%
            const newWidth = Math.round(originalWidth * 0.6);  // 40% reduction = 60% remains
            const newHeight = Math.round(originalHeight * 0.6);
            pipeline = pipeline.resize(newWidth, newHeight, {
                withoutEnlargement: true,
                fit: 'inside'
            });
            console.log(`   🖥️ Full screen - 40% reduction: ${originalWidth}x${originalHeight} → ${newWidth}x${newHeight}`);
        } else if (originalWidth > MEDIUM_THRESHOLD) {
            // Medium image (regular post) - reduce by 30%
            const newWidth = Math.round(originalWidth * 0.7);  // 30% reduction = 70% remains
            const newHeight = Math.round(originalHeight * 0.7);
            pipeline = pipeline.resize(newWidth, newHeight, {
                withoutEnlargement: true,
                fit: 'inside'
            });
            console.log(`   📱 Regular post - 30% reduction: ${originalWidth}x${originalHeight} → ${newWidth}x${newHeight}`);
        } else {
            // Small image - keep original size
            console.log(`   📷 Small image - keeping original size: ${originalWidth}x${originalHeight}`);
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

        console.log(`📊 Optimization results:`);
        console.log(`   Original size: ${originalSizeMB} MB`);
        console.log(`   Optimized size: ${optimizedSizeMB} MB`);
        console.log(`   Savings: ${reduction}%`);
        console.log(`✅ Optimized image saved to: ${outputPath}`);

        return outputPath;

    } catch (error) {
        console.error('❌ Optimization error:', error);
        console.warn('⚠️ Using original image');
        return inputPath; // Return original on error
    }
}
