import { Server } from 'http';

const server = new Server();
const key = Deno.env.get('STEAM_WEB_API_KEY') ?? '';
const pass = Deno.env.get('PASS') ?? '';

if (!key || !pass) Deno.exit(0);

const ADDRESS_REGEXP = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)(\.(?!$)|$)){4}$/;
const SERVER_QUERY_URL =
	'https://api.steampowered.com/IGameServersService/GetServerList/v1/';

interface DayZServerInfo {
	name: string;
	address: string;
	port: number;
	players: {
		current: number;
		queue: number;
		max: number;
	};
	env: {
		map: string;
		time: string;
		acceleration: number;
		nightAcceleration: number;
	};
}

interface RawDayZServerInfo {
	name: string;
	addr: string;
	gameport: number;
	gametype: string;
	players: number;
	max_players: number;
	map: string;
}

const getData = async (): Promise<DayZServerInfo[] | null> => {
	const query = new URLSearchParams({
		key,
		filter: `\\appid\\221100`,
		limit: `${100000}`,
	});

	const url = `${SERVER_QUERY_URL}?${query}`;
	const data = await fetch(url)
		.then((res) => res.json())
		.catch(() => null);

	if (!data) return null;

	const servers = data.response.servers;

	return servers.map((server: RawDayZServerInfo) => {
		const info = {
			name: server.name,
			address: server.addr.split(':')[0],
			port: +server.gameport,
			env: {
				map: server.map,
				time: '00:00',
				acceleration: 1,
				nightAcceleration: 1,
			},
			players: {
				current: server.players,
				queue: 0,
				max: server.max_players,
			},
		} as DayZServerInfo;

		const flags = server.gametype.split(',');
		for (const flag of flags) {
			if (/lqs\d+/.test(flag)) info.players.queue = parseInt(flag.slice(3));
			if (flag === 'etm') info.env.acceleration = parseInt(flag.slice(3));
			if (flag === 'entm') info.env.nightAcceleration = parseInt(flag.slice(4));
			if (/\d+:\d+/.test(flag)) info.env.time = flag;
		}

		return info;
	});
};

let servers = await getData();
let last = Date.now();
const cache = new Map<[string, number], DayZServerInfo>();

server.get('/*', ({ respond, headers }) => {
	if (
		!headers.authorization ||
		headers.authorization !== pass
	) return respond({ status: 401 });
});

server.get('/:address/:port', async ({ params, respond, responded }) => {
	if (
		!params.address || !params.port ||
		!ADDRESS_REGEXP.test(params.address) ||
		isNaN(+params.port) ||
		responded
	) return respond({ status: 400 });

	const address = params.address;
	const port = +params.port;

	if (last > Date.now() - 10_000) {
		last = Date.now();
		servers = await getData();
		cache.clear();
	}

	if (!servers) return respond({ status: 500 });

	const cached = cache.get([address, port]);
	if (cached) return respond({ body: JSON.stringify(cached) });

	const server = servers.find((server) =>
		server.address === address && server.port === port
	);

	if (!server) return respond({ status: 404 });
	cache.set([address, port], server);
	respond({ body: JSON.stringify(server) });
});

server.get('/*', ({ respond }) => respond({ status: 404 }));

server.listen();
