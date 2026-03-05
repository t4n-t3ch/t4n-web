import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
    try {
        const cookieStore = cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value;
                    },
                },
            }
        );
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: userData } = await supabase
            .from('users')
            .select('plan, stripe_customer_id')
            .eq('id', user.id)
            .single();

        const { data: subscription } = await supabase
            .from('subscriptions')
            .select('status, cancel_at_period_end, current_period_end')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .maybeSingle();

        return NextResponse.json({
            plan: userData?.plan || 'free',
            hasSubscription: !!userData?.stripe_customer_id,
            subscription: subscription ? {
                status: subscription.status,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                currentPeriodEnd: subscription.current_period_end,
            } : null,
        });
    } catch (error) {
        console.error('Failed to get status:', error);
        return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
    }
}