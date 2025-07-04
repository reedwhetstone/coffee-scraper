/** @format */

export interface CleaningFieldConfig {
  field: string;
  prompt: string;
  validation?: (value: any) => boolean;
}

export const CLEANING_FIELD_CONFIGS: CleaningFieldConfig[] = [
  {
    field: 'cultivarDetail',
    prompt: `Extract coffee variety/cultivar information from the provided coffee descriptions. 
Look for specific coffee variety names like Typica, Bourbon, Caturra, Geisha, SL28, etc.
If multiple varieties are mentioned, list them separated by commas.`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'processing',
    prompt: `Extract coffee processing method information from the provided coffee descriptions.
Look for processing terms like: Washed, Natural, Honey, Semi-washed, Wet-hulled, Anaerobic, etc.
Use standard processing terminology.`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'region',
    prompt: `Extract geographical region information from the provided coffee descriptions.
Look for country, state/province, and specific region names.
Format as "Region, Country" when both are available (e.g., "Huila, Colombia").`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'grade',
    prompt: `Extract coffee grade or elevation information from the provided coffee descriptions.
Look for altitude/elevation (e.g., "1,500-1,800 masl", "1200m"), 
grade classifications (e.g., "AA", "SHB", "Grade 1"), or 
screen sizes (e.g., "17/18", "15+").`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'roastRecs',
    prompt: `Extract roasting recommendations from the provided coffee descriptions.
Look for suggested roast levels like: Light, Medium-light, Medium, Medium-dark, Dark, 
or specific roasting guidance and temperature recommendations.`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'dryingMethod',
    prompt: `Extract drying method information from the provided coffee descriptions.
Look for drying techniques like: Sun-dried, Patio-dried, Mechanical drying, 
Raised beds, African beds, Greenhouse drying, etc.`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'lotSize',
    prompt: `Extract lot size information from the provided coffee descriptions.
Look for the size of the coffee lot in bags, pounds, kilograms, or other units.
Include the unit when mentioned (e.g., "150 bags", "3,000 lbs").`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'bagSize',
    prompt: `Extract bag size information from the provided coffee descriptions.
Look for individual bag weights like "60kg", "69kg", "150lb", etc.`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'packaging',
    prompt: `Extract packaging information from the provided coffee descriptions.
Look for packaging details like bag types (jute, GrainPro, vacuum-sealed), 
bag materials, or packaging specifications.`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'appearance',
    prompt: `Extract coffee bean appearance information from the provided coffee descriptions.
Look for descriptions of bean size, color, uniformity, defects, or physical characteristics.`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
  {
    field: 'type',
    prompt: `Extract importer information from the provided coffee descriptions.
Look for coffee importer names, or explaination of how the coffee is imported. Example: "Farm Gate", "Organic/Fair Trade Cert.", "Direct Trade", "DIMTU COFFEE INDUSTRY PLC"`,
    validation: (value: string) => typeof value === 'string' && value.length > 0,
  },
];

export function createCleaningPrompt(
  fieldName: string,
  descriptionLong: string | null,
  descriptionShort: string | null,
  farmNotes: string | null
): string {
  const config = CLEANING_FIELD_CONFIGS.find((c) => c.field === fieldName);
  if (!config) {
    throw new Error(`No cleaning configuration found for field: ${fieldName}`);
  }

  const availableDescriptions = [
    descriptionLong && `Long Description: ${descriptionLong}`,
    descriptionShort && `Short Description: ${descriptionShort}`,
    farmNotes && `Farm Notes: ${farmNotes}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!availableDescriptions) {
    throw new Error('No description text available for cleaning');
  }

  return `${config.prompt}

Available coffee information:
${availableDescriptions}

Extract the ${fieldName} information and return it as a JSON object with the field "${fieldName}".`;
}
