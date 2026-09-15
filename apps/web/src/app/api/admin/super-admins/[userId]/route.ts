import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Revoga Super Admin — ADR-0007. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  return encaminhar(`/admin/super-admins/${userId}`, { method: 'DELETE' })
}
