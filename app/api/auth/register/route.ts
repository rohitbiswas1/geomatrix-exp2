import { passwordAuth } from '../../../../lib/passwordAuth';

export const maxDuration = 150;
export async function POST(request: Request) { return passwordAuth(request, 'register'); }
