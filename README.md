```markdown
# Housing Stability Planning Dashboard

A static GitHub Pages dashboard that helps households combine their own budget information with local county economic context from ACS data.

## What the dashboard does

The dashboard allows a household to choose a state and county, enter household budget values, and submit the form to receive a housing stability planning summary. It calculates:

- Housing burden: rent plus utilities divided by monthly income
- Monthly cushion: income left after rent, utilities, essentials, and required payments
- Savings coverage: emergency savings divided by monthly essential expenses
- County economic stress score: based on poverty, unemployment, rent pressure, renter share, and severe renter cost burden
- Final planning concern score: 75% household pressure score and 25% local county stress score

The dashboard does not run while the user is typing. It runs only after the user clicks **Calculate my housing stability plan**. After submission, the input boxes clear while the result summary remains visible.

## Important language

This is a planning and screening tool. It is not an eviction prediction model, legal advice tool, or assistance eligibility tool.

Use language such as:

> Low planning concern, moderate planning concern, high planning concern, and severe planning concern.

Avoid language such as:

> You will be evicted.

## Main files

```text
index.html
style.css
script.js
data/county_indicators.json
data/metadata.json
data/basic_needs.csv
scripts/update_county_data.py
.github/workflows/update-data.yml
.nojekyll
README.md
```

## How to update real county data

1. Add a Census API key to your GitHub repository secrets.
2. Use this exact secret name:

```text
CENSUS_API_KEY
```

3. Go to **Actions**.
4. Run **Update real county data**.
5. After the workflow finishes, check that `data/county_indicators.json` contains real county records.

## GitHub Pages setup

1. Upload all files to the root of your GitHub repository.
2. Go to **Settings → Pages**.
3. Choose **Deploy from branch**.
4. Select the `main` branch and root folder.
5. Save and open the Pages link.

## Data note

The dashboard automatically uses the latest ACS 5-year county record available in the data file. Users do not choose a year because ACS county indicators are not live real-time annual observations.


```
