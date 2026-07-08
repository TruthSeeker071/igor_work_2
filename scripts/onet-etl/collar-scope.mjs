/**
 * MVP collar classification for O*NET occupations.
 * Blue-collar excluded; white/gray/pink/green/new/gold remain in scope.
 */

/** SOC major groups fully excluded (blue-collar). */
export const EXCLUDED_SOC_MAJORS = new Set(['47', '49', '53']);

/**
 * SOC 51 minor-group prefixes allowed in MVP (technicians / programmers / precision roles).
 * Format: first 4 chars of SOC e.g. "51-40"
 */
export const SOC_51_ALLOW_PREFIXES = [
  '51-40', // metal/plastic workers — setters, operators, tenders
  '51-41', // tool & die makers
  '51-80', // plant/system operators
  '51-81', // power plant / stationary engineers
  '51-82', // water/wastewater treatment
  '51-83', // petroleum pump / refinery operators
  '51-84', // chemical plant operators
  '51-85', // gas plant operators
  '51-86', // petroleum / chemical pump operators
  '51-87', // pumping station operators
  '51-88', // stationary engineers (alt)
  '51-89', // other plant operators
  '51-90', // supervisors production (gray-collar management)
  '51-91', // supervisors production workers
  '51-92', // supervisors production (misc)
];

/** Title patterns that force blue-collar exclusion when not caught by SOC. */
export const BLUE_COLLAR_TITLE_PATTERNS = [
  /\blaborer\b/i,
  /\bjanitor\b/i,
  /\bcleaner\b/i,
  /\bhousekeep/i,
  /\bmover\b/i,
  /\bdriver\b/i,
  /\btruck\b/i,
  /\bwarehouse\b/i,
  /\bassembler\b/i,
  /\bpacker\b/i,
  /\bwelder\b/i,
  /\bcarpenter\b/i,
  /\bmason\b/i,
  /\broofer\b/i,
  /\bplumber\b/i,
  /\bpipefitter\b/i,
  /\belectrician\b/i,
  /\bconstruction labor/i,
  /\bbrickmason\b/i,
  /\bconcrete finisher/i,
  /\bexcavat/i,
  /\bmining\b/i,
  /\boil rig\b/i,
  /\bforklift\b/i,
  /\bgroundskeep/i,
  /\blandscap/i,
  /\bmaid\b/i,
  /\bdishwash/i,
  /\bfast food\b/i,
  /\bcook\b/i,
  /\bwaiter\b/i,
  /\bwaitress\b/i,
  /\bbartender\b/i,
  /\bcashier\b/i,
  /\bstock clerk\b/i,
  /\bhand pack/i,
  /\bhand sew/i,
  /\bslaughter/i,
  /\bmeat cutter\b/i,
  /\bfarmworker/i,
  /\bfarm labor/i,
];

function socMinorPrefix(soc) {
  const s = String(soc || '');
  const dot = s.indexOf('.');
  if (dot < 0) return s.slice(0, 5);
  return s.slice(0, dot);
}

function isSoc51Allowed(soc) {
  const prefix = socMinorPrefix(soc);
  return SOC_51_ALLOW_PREFIXES.some((p) => prefix.startsWith(p) || prefix === p);
}

function titleMatchesBlueCollar(title) {
  const t = String(title || '');
  return BLUE_COLLAR_TITLE_PATTERNS.some((re) => re.test(t));
}

function collarFromSocMajor(major, jobZone) {
  if (major === '15') return 'new';
  if (major === '45') return 'green';
  if (['31', '35', '39'].includes(major)) return 'pink';
  if (['17', '19', '29', '33', '37'].includes(major)) return 'gray';
  if (['11', '13', '23', '27', '41', '43', '25'].includes(major)) return 'white';
  if (jobZone >= 4) return 'gold';
  return 'white';
}

/**
 * @param {string} soc
 * @param {string} title
 * @param {string} [hubZone]
 * @param {number|null} [jobZone]
 * @returns {{ collarCategory: string, mvpInScope: boolean, exclusionReason: string|null }}
 */
export function classifyCareer(soc, title, hubZone, jobZone) {
  const major = String(soc || '').slice(0, 2);
  const jz = jobZone != null ? Number(jobZone) : null;

  if (EXCLUDED_SOC_MAJORS.has(major)) {
    return {
      collarCategory: 'blue',
      mvpInScope: false,
      exclusionReason: `soc_major_${major}`,
    };
  }

  if (major === '51') {
    if (!isSoc51Allowed(soc)) {
      return {
        collarCategory: 'blue',
        mvpInScope: false,
        exclusionReason: 'soc_51_production_operator',
      };
    }
    return { collarCategory: 'gray', mvpInScope: true, exclusionReason: null };
  }

  if (titleMatchesBlueCollar(title)) {
    return {
      collarCategory: 'blue',
      mvpInScope: false,
      exclusionReason: 'title_blue_collar',
    };
  }

  const collarCategory = collarFromSocMajor(major, jz);
  return { collarCategory, mvpInScope: true, exclusionReason: null };
}
