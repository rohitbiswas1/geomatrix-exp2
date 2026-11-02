import { passwordAuth } from '../../../../lib/passwordAuth';

export const maxDuration = 90;
export async function POST(request: Request) { return passwordAuth(request, 'login'); }
