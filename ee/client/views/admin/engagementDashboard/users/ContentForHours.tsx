import { ResponsiveBar } from '@nivo/bar';
import { Box, Button, Chevron, Skeleton } from '@rocket.chat/fuselage';
import { useBreakpoints } from '@rocket.chat/fuselage-hooks';
import colors from '@rocket.chat/fuselage-tokens/colors.json';
import moment from 'moment';
import React, { ReactElement, useMemo } from 'react';

import { useTranslation } from '../../../../../../client/contexts/TranslationContext';
import { useHourlyChatActivity } from './useHourlyChatActivity';

type ContentForHoursProps = {
	displacement: number;
	onPreviousDateClick: () => void;
	onNextDateClick: () => void;
	timezone: 'utc' | 'local';
};

const ContentForHours = ({
	displacement,
	onPreviousDateClick,
	onNextDateClick,
	timezone,
}: ContentForHoursProps): ReactElement => {
	const utc = timezone === 'utc';
	const { data } = useHourlyChatActivity({ displacement, utc });

	const t = useTranslation();
	const isLgScreen = useBreakpoints().includes('lg');

	const values = useMemo(() => {
		if (!data) {
			return [];
		}

		const divider = 2;
		const values = Array.from({ length: 24 / divider }, (_, i) => ({
			hour: String(divider * i),
			users: 0,
		}));

		for (const { hour, users } of data?.hours ?? []) {
			const i = Math.floor(hour / divider);
			values[i] = values[i] || { hour: String(divider * i), users: 0 };
			values[i].users += users;
		}

		return values;
	}, [data]);

	return (
		<>
			<Box display='flex' alignItems='center' justifyContent='center'>
				<Button ghost square small onClick={onPreviousDateClick}>
					<Chevron left size='x20' style={{ verticalAlign: 'middle' }} />
				</Button>
				<Box mi='x8' flexBasis='25%' is='span' style={{ textAlign: 'center' }}>
					{data ? moment(data.day).format(displacement < 7 ? 'dddd' : 'L') : null}
				</Box>
				<Button ghost square small disabled={displacement === 0} onClick={onNextDateClick}>
					<Chevron right size='x20' style={{ verticalAlign: 'middle' }} />
				</Button>
			</Box>
			{data ? (
				<Box display='flex' height='196px'>
					<Box alignSelf='stretch' flexGrow={1} flexShrink={0} position='relative'>
						<Box position='absolute' width='100%' height='100%'>
							<ResponsiveBar
								data={values}
								indexBy='hour'
								keys={['users']}
								groupMode='grouped'
								padding={0.25}
								margin={{
									// TODO: Get it from theme
									bottom: 30,
									right: 5,
								}}
								colors={[
									// TODO: Get it from theme
									colors.b500,
								]}
								enableLabel={false}
								enableGridY={false}
								axisTop={null}
								axisRight={null}
								axisBottom={{
									tickSize: 0,
									// TODO: Get it from theme
									tickPadding: 4,
									tickRotation: isLgScreen ? 0 : 25,
									tickValues: 'every 2 hours',
									format: (hour): string =>
										moment().set({ hour, minute: 0, second: 0 }).format('LT'),
								}}
								axisLeft={null}
								animate={true}
								motionStiffness={90}
								motionDamping={15}
								theme={{
									// TODO: Get it from theme
									axis: {
										ticks: {
											text: {
												fill: colors.n600,
												fontFamily:
													'Inter, -apple-system, system-ui, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Meiryo UI", Arial, sans-serif',
												fontSize: '10px',
												fontStyle: 'normal',
												fontWeight: 600,
												letterSpacing: '0.2px',
												lineHeight: '12px',
											},
										},
									},
									tooltip: {
										// @ts-ignore
										backgroundColor: colors.n900,
										boxShadow:
											'0px 0px 12px rgba(47, 52, 61, 0.12), 0px 0px 2px rgba(47, 52, 61, 0.08)',
										borderRadius: 2,
										padding: 4,
									},
								}}
								tooltip={({ value }): ReactElement => (
									<Box fontScale='p1m' color='alternative'>
										{t('Value_users', { value })}
									</Box>
								)}
							/>
						</Box>
					</Box>
				</Box>
			) : (
				<Skeleton variant='rect' height={196} />
			)}
		</>
	);
};

export default ContentForHours;
