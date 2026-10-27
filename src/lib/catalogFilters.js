import { artistTypeKeys, normalizeSearch } from './artistFilters.js';
import { searchArtist } from './artists.js';

export const MISSING = '__missing__';

export function catalogRowFacets(row, kind, catalog) {
  const members = kind === 'cp'
    ? [row.artist_1_id, row.artist_2_id].map(id => catalog.find(a => a.id === id)).filter(Boolean)
    : [];
  const records = kind === 'cp' ? members : [row];
  return {
    companies: [...new Set(records.map(a => normalizeSearch(a.company) || MISSING))],
    categories: [...new Set(records.flatMap(a => {
      const keys = artistTypeKeys(a);
      return keys.length ? keys : [MISSING];
    }))],
  };
}

// null means unrestricted; [] deliberately means no options selected.
export function matchesFacet(values, selected) {
  return selected === null || selected.some(value => values.includes(value));
}

export function matchesCatalogRow(row, kind, catalog, filters) {
  if (!!row.deleted_at !== filters.trash) return false;
  const members = kind === 'cp'
    ? [row.artist_1_id, row.artist_2_id].map(id => catalog.find(a => a.id === id)).filter(Boolean)
    : kind === 'group'
      ? (row.group_member_ids || row.members || []).map(id => catalog.find(a => a.id === id)).filter(Boolean)
      : [];
  const query = normalizeSearch(filters.query);
  const searchable = kind === 'cp' ? { name: row.cp_name, aliases: row.aliases || [] } : row;
  if (query && !searchArtist(searchable, query) && !members.some(a => searchArtist(a, query))) return false;
  const facets = catalogRowFacets(row, kind, catalog);
  return matchesFacet(facets.companies, filters.companies) && matchesFacet(facets.categories, filters.categories);
}
