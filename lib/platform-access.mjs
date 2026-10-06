// The platform role is server-owned in Cargo. Capacity's existing roles remain
// independent when there is no superuser override.
export function platformProfile(user, access) {
  if (!access || access.id !== user.id) return null;
  const identity = { user_id: user.id, email: access.email || user.email || '',
    full_name: access.full_name || user.email || '', company: 'GNS Cargo AS' };
  if (access.blocked || access.deleted_at) return { ...identity, role: 'carrier', approved: false,
    platform_blocked: true, deleted_at: access.deleted_at || null };
  if (access.role === 'superuser') return { ...identity, role: 'admin', approved: true,
    platform_role: 'superuser', deleted_at: null };
  return null;
}

export function platformUsers(profiles, flags) {
  const access = new Map((flags || []).map(flag => [flag.user_id, flag]));
  return profiles.filter(profile => !access.get(profile.user_id)?.platform_deleted).map(profile => {
    const flag = access.get(profile.user_id) || {};
    return { ...profile, ...flag,
      role: flag.platform_superuser ? 'admin' : profile.role,
      approved: flag.platform_blocked ? false : flag.platform_superuser ? true : profile.approved };
  });
}
