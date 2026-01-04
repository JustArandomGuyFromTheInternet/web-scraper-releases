import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import os from 'os';

const SUPABASE_URL = 'https://ixlquddfwvclzwhuewic.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wUMO_oRyhBVNbwTraLfS8Q_Jm_Fjbnb';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function getMachineId() {
    const cpu = os.cpus()?.[0]?.model || '';
    const hostname = os.hostname() || '';
    const nets = os.networkInterfaces() || {};
    const macs = Object.values(nets)
        .flat()
        .filter(Boolean)
        .map((n) => n.mac)
        .filter(Boolean)
        .join('|');

    return crypto
        .createHash('sha256')
        .update(cpu)
        .update(hostname)
        .update(macs)
        .digest('hex');
}

export async function checkLicense() {
    const machineId = getMachineId();

    try {
        let { data, error } = await supabase
            .from('licenses')
            .select('*')
            .eq('machine_id', machineId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase error:', error);
        }

        if (!data) {
            const { data: newLicense, error: insertError } = await supabase
                .from('licenses')
                .insert([{ machine_id: machineId }])
                .select()
                .single();

            if (insertError) {
                console.error('Insert license error:', insertError);
                throw insertError;
            }

            data = newLicense;
        }

        const now = new Date();
        const trialEnd = new Date(data.trial_end);
        const daysLeft = Math.ceil(
            (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        const valid = data.is_paid || daysLeft > 0;

        return {
            valid,
            daysLeft: data.is_paid ? Infinity : daysLeft,
            isPaid: data.is_paid,
            machineId,
        };
    } catch (err) {
        console.error('License check failed, falling back to local:', err);
        return {
            valid: true,
            daysLeft: 3,
            isPaid: false,
            offline: true,
        };
    }
}

export async function activateLicense(licenseKey) {
    const machineId = getMachineId();

    const { data, error } = await supabase
        .from('licenses')
        .update({
            is_paid: true,
            license_key: licenseKey,
        })
        .eq('machine_id', machineId)
        .select()
        .single();

    if (error) {
        console.error('Activate license error:', error);
        throw new Error('Invalid license key');
    }

    return {
        success: true,
        data,
    };
}
