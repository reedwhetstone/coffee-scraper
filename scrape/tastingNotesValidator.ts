/** @format */

import { z } from 'zod';

// Regular expressions for validation
const tagRegex = /^[a-z][a-z\s\-]*[a-z]$|^[a-z]$/; // 1-3 words, lowercase, allows spaces or hyphens
const hexColorRegex = /^#[0-9a-f]{6}$/i; // Hex color format #RRGGBB

// Individual attribute schema
const tastingAttributeSchema = z.object({
  score: z.number().int().min(1).max(5),
  tag: z.string().regex(tagRegex, "Tag must be 1-3 lowercase words, may contain spaces or hyphens"),
  color: z.string().regex(hexColorRegex, "Color must be valid hex format #RRGGBB")
});

// Complete tasting notes schema
const tastingNotesSchema = z.object({
  fragrance_aroma: tastingAttributeSchema,
  flavor: tastingAttributeSchema,
  acidity: tastingAttributeSchema,
  body: tastingAttributeSchema,
  sweetness: tastingAttributeSchema
});

export type TastingAttribute = z.infer<typeof tastingAttributeSchema>;
export type TastingNotes = z.infer<typeof tastingNotesSchema>;

export interface TastingNotesValidationResult {
  success: boolean;
  data?: TastingNotes;
  errors?: string[];
}

/**
 * Validates AI-generated tasting notes against the schema
 * @param tastingNotes - The tasting notes object to validate
 * @returns Validation result with success status and data or errors
 */
export function validateTastingNotes(tastingNotes: unknown): TastingNotesValidationResult {
  try {
    const validatedData = tastingNotesSchema.parse(tastingNotes);
    return {
      success: true,
      data: validatedData
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      );
      return {
        success: false,
        errors
      };
    }
    return {
      success: false,
      errors: [`Validation error: ${error}`]
    };
  }
}

/**
 * Validates individual tag requirements (helper function)
 * @param tag - The tag string to validate
 * @returns Boolean indicating if tag is valid
 */
export function isValidTag(tag: string): boolean {
  if (!tag || typeof tag !== 'string') return false;
  
  // Check length (1-3 words)
  const words = tag.trim().split(/\s+/);
  if (words.length < 1 || words.length > 3) return false;
  
  // Check format (lowercase, allows spaces/hyphens)
  return tagRegex.test(tag.toLowerCase());
}

/**
 * Validates hex color format (helper function)
 * @param color - The color string to validate
 * @returns Boolean indicating if color is valid hex
 */
export function isValidHexColor(color: string): boolean {
  if (!color || typeof color !== 'string') return false;
  return hexColorRegex.test(color);
}

/**
 * Sanitizes and corrects common formatting issues in tasting notes
 * @param rawTastingNotes - Raw tasting notes from LLM
 * @returns Sanitized tasting notes object
 */
export function sanitizeTastingNotes(rawTastingNotes: any): any {
  if (!rawTastingNotes || typeof rawTastingNotes !== 'object') {
    return rawTastingNotes;
  }

  const sanitized = { ...rawTastingNotes };

  // Sanitize each attribute
  for (const [key, value] of Object.entries(sanitized)) {
    if (value && typeof value === 'object') {
      const attr = value as any;
      
      // Sanitize tag: convert to lowercase, trim whitespace
      if (attr.tag && typeof attr.tag === 'string') {
        attr.tag = attr.tag.toLowerCase().trim();
      }
      
      // Sanitize color: ensure # prefix and lowercase
      if (attr.color && typeof attr.color === 'string') {
        let color = attr.color.trim().toLowerCase();
        if (!color.startsWith('#')) {
          color = '#' + color;
        }
        attr.color = color;
      }
      
      // Sanitize score: ensure integer
      if (attr.score && typeof attr.score === 'number') {
        attr.score = Math.round(attr.score);
      }
    }
  }

  return sanitized;
}

export default {
  validateTastingNotes,
  isValidTag,
  isValidHexColor,
  sanitizeTastingNotes,
  tastingNotesSchema,
  tastingAttributeSchema
};