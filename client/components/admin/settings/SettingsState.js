import { Mongo } from 'meteor/mongo';
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, useLayoutEffect, useMemo } from 'react';

import { PrivateSettingsCachedCollection } from '../../../../app/ui-admin/client/SettingsCachedCollection';

const SettingsContext = createContext({});

let privateSettingsCachedCollection; // Remove this singleton (╯°□°)╯︵ ┻━┻

const compareStrings = (a = '', b = '') => {
	if (a === b || (!a && !b)) {
		return 0;
	}

	return a > b ? 1 : -1;
};

const compareSettings = (a, b) =>
	compareStrings(a.section, b.section)
	|| compareStrings(a.sorter, b.sorter)
	|| compareStrings(a.i18nLabel, b.i18nLabel);

const stateReducer = (state, { type, payload }) => {
	switch (type) {
		case 'add':
			return [...state, ...payload].sort(compareSettings);

		case 'change':
			return state.map((setting) => (setting._id !== payload._id ? setting : payload));

		case 'remove':
			return state.filter((setting) => setting._id !== payload);

		case 'hydrate': {
			const map = {};
			payload.forEach((setting) => {
				map[setting._id] = setting;
			});

			return state.map((setting) => (map[setting._id] ? { ...setting, ...map[setting._id] } : setting));
		}
	}

	return state;
};

export function SettingsState({ children }) {
	const [state, updateState] = useReducer(stateReducer, []);
	const [persistedState, updatePersistedState] = useReducer(stateReducer, []);
	const [isLoading, setLoading] = useState(true);

	const updateStates = (action) => {
		updateState(action);
		updatePersistedState(action);
	};

	const stopLoading = () => {
		setLoading(false);
	};

	const persistedCollectionRef = useRef();

	useEffect(() => {
		if (!privateSettingsCachedCollection) {
			privateSettingsCachedCollection = new PrivateSettingsCachedCollection();
			privateSettingsCachedCollection.init().then(stopLoading, stopLoading);
		}

		persistedCollectionRef.current = privateSettingsCachedCollection.collection;
	}, []);

	const { current: persistedCollection } = persistedCollectionRef;

	const [collection] = useState(() => new Mongo.Collection(null));

	useEffect(() => {
		if (isLoading) {
			return;
		}

		const addedQueue = [];
		let addedActionTimer;

		const added = (data) => {
			collection.insert(data);
			addedQueue.push(data);
			clearTimeout(addedActionTimer);
			addedActionTimer = setTimeout(() => {
				updateStates({ type: 'add', payload: addedQueue });
			}, 70);
		};

		const changed = (data) => {
			collection.update(data._id, data);
			updateStates({ type: 'change', payload: data });
		};

		const removed = ({ _id }) => {
			collection.remove(_id);
			updateStates({ type: 'remove', payload: _id });
		};

		const persistedFieldsQueryHandle = persistedCollection.find()
			.observe({
				added,
				changed,
				removed,
			});

		return () => {
			persistedFieldsQueryHandle.stop();
			clearTimeout(addedActionTimer);
		};
	}, [isLoading]);

	const updateTimersRef = useRef({});

	const updateAtCollection = ({ _id, ...data }) => {
		const { current: updateTimers } = updateTimersRef;
		clearTimeout(updateTimers[_id]);
		updateTimers[_id] = setTimeout(() => {
			collection.update(_id, { $set: data });
		}, 70);
	};

	const collectionRef = useRef();
	const updateAtCollectionRef = useRef();
	const updateStateRef = useRef();

	useEffect(() => {
		collectionRef.current = collection;
		updateAtCollectionRef.current = updateAtCollection;
		updateStateRef.current = updateState;
	});

	const hydrate = useCallback((changes) => {
		const { current: updateAtCollection } = updateAtCollectionRef;
		const { current: updateState } = updateStateRef;
		changes.forEach(updateAtCollection);
		updateState({ type: 'hydrate', payload: changes });
	}, []);

	const isDisabled = useCallback(({ blocked, enableQuery }) => {
		if (blocked) {
			return true;
		}

		if (!enableQuery) {
			return false;
		}

		const { current: collection } = collectionRef;

		const queries = [].concat(typeof enableQuery === 'string' ? JSON.parse(enableQuery) : enableQuery);
		return !queries.every((query) => !!collection.findOne(query));
	}, []);

	const stateRef = useRef({
		isLoading,
		state,
		persistedState,
		hydrate,
		isDisabled,
	});

	const subscribersRef = useRef(new Set());

	const subscribe = (fn) => {
		subscribersRef.current.add(fn);
		return () => {
			subscribersRef.current.delete(fn);
		};
	};

	useLayoutEffect(() => {
		stateRef.current = {
			isLoading,
			state,
			persistedState,
			hydrate,
			isDisabled,
		};

		for (const fn of subscribersRef.current) {
			fn(stateRef.current);
		}
	});

	const contextValue = useMemo(() => ({
		stateRef,
		subscribe,
	}), []);

	return <SettingsContext.Provider children={children} value={contextValue} />;
}

export const useSettingsState = (selector = (state) => state) => {
	const { stateRef, subscribe } = useContext(SettingsContext);
	const [value, setValue] = useState(() => selector(stateRef.current));
	const previousValueRef = useRef();

	useEffect(() => {
		const unsubscribe = subscribe((state) => {
			const newValue = selector(state);
			if (newValue !== previousValueRef.current) {
				setValue((previousValue) => {
					previousValueRef.current = previousValue;
					return newValue;
				});
			}
		});

		return () => {
			unsubscribe();
		};
	}, []);

	return value;
};
