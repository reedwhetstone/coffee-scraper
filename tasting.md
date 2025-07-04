<!-- @format -->

Using my existing gemini API (use env variable GENINI_API_KEY) I need to set up data cleaning and interpretation layer, on new scraped data output from coffee-scraper/scrape/newcoffeescript.ts that does the following
##INNITIAL CLEANING

1. Collect NULL value columns in new rows from initial web scrape from purveyors/coffee-scraper/scrape/newcoffeescript.ts
2. Send those columns to LLM API (gemini) and provide description_long, description_short, farm_notes
3. Instruct the API to identify factual data that would fill those NULL column data points.
4. LLM sents back output which is added to the table - for example, if the varietal is NULL but varietal is described in the description_long column,
   it would provide a revision to the varietal column with the varietal information such as "typica". The LLM should ONLY make cleaning or additive adjustments to the data when it is NULL.

##AI DESCRIPTION

1. LLM reads description_long, description_short, farm_notes and converts the language from these cells
   into "translated" factual fair use converted output. Focus on informational data. Produce a fair‑use‑compliant, ~35‑word synopsis that keeps any unique origin story but strips hype.
2. Synopsys output is sent to ai.description

Fair‑use & compliance

- Prompt instructs Gemini to quote no more than 6 consecutive words from source.
- Emphasise factual tone, no superlatives unless present in source.

llm input: description_long, description_short, farm_notes
llm output: coffee_catalog.ai_description - short summary of the input,using unique language from the input to create a new description that would meet
fair use.

##AI TASTING NOTES coffee_catalog.ai_tasting_notes - use the prompt
@coffee-scraper/tasting.md to start with. Create a typescript function to
check the validity of the output from the LLM before sending it to the db.

Checking function requirements -
Requirement - Where enforced
score 1‑5 integer - z.number().int().min(1).max(5)
tag ≤ 3 words, lower‑case - tagRegex (allows spaces or hyphens)
color valid hex #RRGGBB - hexColorRegex
All five attributes present - Top‑level z.object({...}) definition

I'll do the prompts with my existing gemini API that I'm already using in the coffee-app chat

SYSTEM:
You are a certified Q‑grader.  
Read a free‑form coffee description and return a tasting profile as _strict_ JSON.  
✱ Use **only** the schema below.  
✱ Do **not** wrap the JSON in markdown.  
✱ Each attribute must have:
• score — integer 1‑5  
 • tag — 1‑3 words, lower‑case  
 • color — hex code (e.g. "#7f4a94") that visually represents the tag

SCALE GUIDE  
1 = very weak / defective 2 = weak 3 = moderate 4 = strong 5 = exceptional

ATTRIBUTE EXAMPLES  
fragrance_aroma – jasmine (#e5e4e2), cocoa (#4b3621)  
flavor – berry (#b3164b), caramel (#c68f53)  
acidity – bright (#f4d35e), mellow (#a3c1ad)  
body – light (#d7ccc8), syrupy (#5d4037)  
sweetness – honey‑like (#e4b169), brown‑sugar (#6f4e37)

OUTPUT SCHEMA  
{
"fragrance_aroma": { "score": <1‑5>, "tag": "<1‑3 words>", "color": "<#RRGGBB>" },
"flavor": { "score": <1‑5>, "tag": "<1‑3 words>", "color": "<#RRGGBB>" },
"acidity": { "score": <1‑5>, "tag": "<1‑3 words>", "color": "<#RRGGBB>" },
"body": { "score": <1‑5>, "tag": "<1‑3 words>", "color": "<#RRGGBB>" },
"sweetness": { "score": <1‑5>, "tag": "<1‑3 words>", "color": "<#RRGGBB>" }
}

Default rule: if unsure of an output, infer from context or assign score 3 and tag "average" with color "#8b5a2b".

### FEW‑SHOT EXAMPLES

<assistant_example_1>
{
"fragrance_aroma": { "score": 5, "tag": "blueberry-jam", "color": "#4f2a57" },
"flavor": { "score": 5, "tag": "berry", "color": "#b3164b" },
"acidity": { "score": 4, "tag": "lemon-lime", "color": "#d0e36c" },
"body": { "score": 3, "tag": "medium", "color": "#d7ccc8" },
"sweetness": { "score": 4, "tag": "honey-like", "color": "#e4b169" }
}
</assistant_example_1>

<assistant_example_2>
{
"fragrance_aroma": { "score": 3, "tag": "peanutty", "color": "#c69c6d" },
"flavor": { "score": 3, "tag": "milk-choc", "color": "#7b4b2a" },
"acidity": { "score": 2, "tag": "soft", "color": "#a3c1ad" },
"body": { "score": 4, "tag": "creamy", "color": "#bfa58f" },
"sweetness": { "score": 3, "tag": "brown-sugar", "color": "#6f4e37" }
}
</assistant_example_2>

USER:
<PASTE COFFEE DESCRIPTION HERE>
