import type { ContextProvider, ContextProviderResult, ContextRequest } from '../types';

function numericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
    return Number(parts.find(part => part.type === type)?.value ?? 0);
}

/** Produce deterministic civil-time context for the configured IANA timezone. */
export class TimeContextProvider implements ContextProvider {
    public readonly id = 'time';

    public constructor(private readonly timeZone?: string) {}

    public isAvailable(): Promise<boolean> {
        return Promise.resolve(true);
    }

    public getContext(request: ContextRequest): Promise<ContextProviderResult> {
        const date = new Date(request.timestamp);
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: this.timeZone,
            hour: 'numeric',
            minute: 'numeric',
            weekday: 'short',
            hourCycle: 'h23',
        });
        const parts = formatter.formatToParts(date);
        const weekdayName = parts.find(part => part.type === 'weekday')?.value ?? 'Sun';
        const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
        const time = {
            hour: numericPart(parts, 'hour'),
            minute: numericPart(parts, 'minute'),
            weekday,
            isWeekend: weekday === 0 || weekday === 6,
        };
        return Promise.resolve({
            context: { time },
            provenance: Object.fromEntries(
                Object.keys(time).map(key => [
                    `time.${key}`,
                    {
                        providerId: this.id,
                        quality: 'calculated' as const,
                        confidence: 1,
                        timestamp: request.timestamp,
                    },
                ]),
            ),
        });
    }
}
